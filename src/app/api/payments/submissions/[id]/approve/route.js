import { NextResponse } from "next/server";
import { platformFee, totalChargedToBrand } from "@/lib/commission";
import { createHeldTransfer } from "@/lib/razorpay";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { CAMPAIGN_ROLES, getWorkspaceRole } from "@/lib/workspaces";
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

  // Approving a submission is creative review, so it takes a campaign role, not
  // a money role — releasing the hold is the money step, gated separately in
  // payouts/[id]/release. But it is not "any member with a pulse" either: this
  // used to test `role` for truthiness alone, which let `billing` — the role
  // deliberately excluded from running campaigns — create held transfers.
  const role = campaign ? await getWorkspaceRole(supabase, user, campaign.workspace_id) : null;

  if (submissionError || !submission || !campaign || !role) {
    return NextResponse.json({ error: "Submission not found" }, { status: 404 });
  }

  if (!CAMPAIGN_ROLES.includes(role)) {
    return NextResponse.json(
      { error: "Your role on this workspace can't approve submissions." },
      { status: 403 }
    );
  }

  // Idempotency. Without this, N POSTs create N held Razorpay transfers while
  // the upsert below keeps overwriting one row (the unique index is `nulls not
  // distinct`), so `committed` never grows and the budget guard never trips.
  // The extra transfers have no razorpay_transfer_id recorded anywhere, which
  // means payouts/[id]/release can never release or reverse them.
  if (submission.status === "approved") {
    return NextResponse.json({ error: "This submission is already approved." }, { status: 409 });
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
    // view_count_at_submission is written by the clipper's own browser
    // (submission-form.jsx inserts it directly), so it is a display value, not
    // an input to a transfer. A per-view payout comes from the synced
    // youtube_videos row or it does not get computed at all — there is no
    // fallback, because the fallback was a number the payee chose.
    const videoId = extractYoutubeVideoId(submission.video_url);

    if (!videoId) {
      return NextResponse.json(
        { error: "That submission's URL isn't a YouTube video, so views can't be verified." },
        { status: 400 }
      );
    }

    const { data: video } = await admin
      .from("youtube_videos")
      .select("view_count")
      .eq("user_id", submission.clipper_id)
      .eq("video_id", videoId)
      .single();

    if (video?.view_count == null) {
      return NextResponse.json(
        {
          error:
            "This video isn't synced yet, so its view count can't be verified. Ask the creator to sync their channel from Connectors, then approve again.",
        },
        { status: 400 }
      );
    }

    amount = (video.view_count / 1000) * agreedRate;
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

  // Compare-and-swap, and the real idempotency lock — the status check on entry
  // only catches a sequential retry, not two requests racing. `neq` makes this
  // the atomic claim: exactly one caller flips submitted -> approved and gets a
  // row back, and the loser stops here instead of creating a second transfer.
  //
  // On the admin client, and the error is checked. It used to run on the
  // RLS-scoped client with the result discarded entirely, so a refused write
  // still fell through to createHeldTransfer below.
  const { data: claimed, error: claimError } = await admin
    .from("campaign_submissions")
    .update({ status: "approved", updated_at: new Date().toISOString() })
    .eq("id", id)
    .neq("status", "approved")
    .select("id");

  if (claimError) {
    console.error("Submission approval status write failed", claimError);
    return NextResponse.json({ error: "Couldn't approve this submission." }, { status: 500 });
  }

  if (!claimed?.length) {
    return NextResponse.json({ error: "This submission is already approved." }, { status: 409 });
  }

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
      { onConflict: "application_id,milestone_id" }
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
      { onConflict: "application_id,milestone_id" }
    );

    // Release the claim taken above. Without this the submission stays
    // `approved` with no held transfer behind it, and the idempotency guard
    // then refuses every retry — one Razorpay hiccup would strand the payout
    // permanently with no way back through the UI.
    const { error: revertError } = await admin
      .from("campaign_submissions")
      .update({ status: "submitted", updated_at: new Date().toISOString() })
      .eq("id", id);

    if (revertError) {
      console.error("Failed to revert submission status after transfer failure", revertError);
    }

    return NextResponse.json({ error: "Couldn't create the payout transfer." }, { status: 502 });
  }
}
