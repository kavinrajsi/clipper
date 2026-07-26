import { NextResponse } from "next/server";
import { platformFee, totalChargedToBrand } from "@/lib/commission";
import { createHeldTransfer } from "@/lib/razorpay";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceRole } from "@/lib/workspaces";
import { extractYoutubeVideoId } from "@/lib/youtube";

export async function POST(request, { params }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: submission, error: submissionError } = await supabase
    .from("campaign_submissions")
    .select("*, application:campaign_applications(*, campaign:campaigns(*))")
    .eq("id", id)
    .single();

  const campaign = submission?.application?.campaign;

  // Approving a submission is creative review, so any workspace member may do
  // it. The held transfer it creates is not yet a release — that still needs a
  // money role, enforced in payouts/[id]/release.
  const role = campaign ? await getWorkspaceRole(supabase, user, campaign.workspace_id) : null;

  if (submissionError || !submission || !campaign || !role) {
    return NextResponse.json({ error: "Submission not found" }, { status: 404 });
  }

  if (campaign.funding_status !== "paid" || !campaign.razorpay_payment_id) {
    return NextResponse.json({ error: "Campaign isn't funded yet." }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: payoutAccount } = await admin
    .from("clipper_payout_accounts")
    .select("*")
    .eq("user_id", submission.clipper_id)
    .single();

  if (!payoutAccount || payoutAccount.status !== "active" || !payoutAccount.razorpay_account_id) {
    return NextResponse.json(
      { error: "Clipper hasn't finished setting up their payout account yet." },
      { status: 400 }
    );
  }

  const { data: connection } = await admin
    .from("youtube_connections")
    .select("payout_multiplier")
    .eq("user_id", submission.clipper_id)
    .single();
  const payoutMultiplier = connection?.payout_multiplier ?? 1.0;

  // A clipper may bid a rate other than the one posted. When they did, that is
  // what was agreed and what gets paid; otherwise fall back to the campaign's
  // posted rate. Applies to both payout structures — for per_view it is the
  // rate per 1,000 views.
  const agreedRate = submission.application?.bid_amount ?? campaign.payout_rate;

  let amount = agreedRate;

  if (campaign.payout_structure === "per_view") {
    let viewCount = submission.view_count_at_submission ?? 0;
    const videoId = extractYoutubeVideoId(submission.video_url);

    if (videoId) {
      const { data: video } = await admin
        .from("youtube_videos")
        .select("view_count")
        .eq("user_id", submission.clipper_id)
        .eq("video_id", videoId)
        .single();
      if (video?.view_count != null) viewCount = video.view_count;
    }

    amount = (viewCount / 1000) * agreedRate;
  }

  amount = Math.round(amount * payoutMultiplier * 100) / 100;

  // Approval threshold, checked BEFORE any Razorpay call and never on the
  // client. Only applies once a workspace has set a policy; without one the
  // helper returns false for a missing row, so treat "no policy" as no gate.
  const { data: policy } = await admin
    .from("approval_policies")
    .select("submission_approvals_required")
    .eq("workspace_id", campaign.workspace_id)
    .maybeSingle();

  if (policy && policy.submission_approvals_required > 1) {
    const { data: cleared } = await admin.rpc("has_required_approvals", {
      ws: campaign.workspace_id,
      p_subject_type: "submission",
      p_subject_id: id,
      p_amount: amount,
    });

    if (!cleared) {
      return NextResponse.json(
        {
          error: `This workspace requires ${policy.submission_approvals_required} approvals before a payout is created. Ask a teammate to approve it too.`,
        },
        { status: 400 }
      );
    }
  }

  // A campaign with no payout_rate and an application with no bid makes this
  // NaN, and every downstream comparison against it silently succeeds — the
  // budget check included. Fail here instead of transferring a NaN.
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json(
      { error: "This campaign has no payout rate set, so there's nothing to pay out." },
      { status: 400 }
    );
  }

  // The creator's amount is never reduced by the fee — the brand pays it on
  // top. So the budget has to cover both, and `amount` below stays the number
  // that goes to Razorpay.
  const platformFeeAmount = platformFee(amount);
  const chargedToBrand = totalChargedToBrand(amount);

  if (campaign.budget) {
    const { data: campaignApplications } = await admin
      .from("campaign_applications")
      .select("id")
      .eq("campaign_id", campaign.id);

    const applicationIds = (campaignApplications ?? []).map((application) => application.id);

    const { data: existingPayouts } = await admin
      .from("campaign_payouts")
      .select("amount, platform_fee_amount, status")
      .in("application_id", applicationIds);

    // Historical fees count towards the budget too. Summing `amount` alone
    // would under-count committed spend and over-admit every later payout, so
    // the campaign could overrun by the accumulated fee.
    const committed = (existingPayouts ?? [])
      .filter((payout) => payout.status !== "failed")
      .reduce(
        (sum, payout) => sum + Number(payout.amount) + Number(payout.platform_fee_amount ?? 0),
        0
      );

    if (committed + chargedToBrand > campaign.budget) {
      return NextResponse.json(
        {
          error: `This payout would exceed the campaign's funded budget. ₹${committed.toFixed(2)} already committed of ₹${campaign.budget}, and this one costs ₹${chargedToBrand.toFixed(2)} including the ₹${platformFeeAmount.toFixed(2)} platform fee.`,
        },
        { status: 400 }
      );
    }
  }

  await supabase
    .from("campaign_submissions")
    .update({ status: "approved", updated_at: new Date().toISOString() })
    .eq("id", id);

  try {
    // Transfers the creator's amount only. The fee is realised by staying
    // behind in the platform's Razorpay account, not by a second transfer.
    const transfer = await createHeldTransfer(
      campaign.razorpay_payment_id,
      payoutAccount.razorpay_account_id,
      amount
    );

    const { error: payoutError } = await admin.from("campaign_payouts").upsert(
      {
        application_id: submission.application_id,
        clipper_id: submission.clipper_id,
        amount,
        platform_fee_amount: platformFeeAmount,
        razorpay_transfer_id: transfer.id,
        status: "held",
        held_at: new Date().toISOString(),
      },
      { onConflict: "application_id" }
    );

    if (payoutError) throw payoutError;

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Razorpay transfer creation failed", err);

    // Records the fee that would have been charged. A failed row with the fee
    // silently missing would make the audit trail asymmetric — and this row is
    // excluded from the committed sum anyway, so it costs the brand nothing.
    await admin.from("campaign_payouts").upsert(
      {
        application_id: submission.application_id,
        clipper_id: submission.clipper_id,
        amount,
        platform_fee_amount: platformFeeAmount,
        status: "failed",
      },
      { onConflict: "application_id" }
    );

    return NextResponse.json({ error: "Couldn't create the payout transfer." }, { status: 502 });
  }
}
