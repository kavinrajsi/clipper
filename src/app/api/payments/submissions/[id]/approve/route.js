import { NextResponse } from "next/server";
import { createHeldTransfer } from "@/lib/razorpay";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
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

  if (submissionError || !submission || !campaign || campaign.brand_id !== user.id) {
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

  let amount = campaign.payout_rate;

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

    amount = (viewCount / 1000) * campaign.payout_rate;
  }

  amount = Math.round(amount * payoutMultiplier * 100) / 100;

  if (campaign.budget) {
    const { data: campaignApplications } = await admin
      .from("campaign_applications")
      .select("id")
      .eq("campaign_id", campaign.id);

    const applicationIds = (campaignApplications ?? []).map((application) => application.id);

    const { data: existingPayouts } = await admin
      .from("campaign_payouts")
      .select("amount, status")
      .in("application_id", applicationIds);

    const committed = (existingPayouts ?? [])
      .filter((payout) => payout.status !== "failed")
      .reduce((sum, payout) => sum + Number(payout.amount), 0);

    if (committed + amount > campaign.budget) {
      return NextResponse.json(
        {
          error: `This payout would exceed the campaign's funded budget. ₹${committed.toFixed(2)} already committed of ₹${campaign.budget}.`,
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

    await admin.from("campaign_payouts").upsert(
      {
        application_id: submission.application_id,
        clipper_id: submission.clipper_id,
        amount,
        status: "failed",
      },
      { onConflict: "application_id" }
    );

    return NextResponse.json({ error: "Couldn't create the payout transfer." }, { status: 502 });
  }
}
