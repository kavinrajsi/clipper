import { NextResponse } from "next/server";
import { releaseTransferHold } from "@/lib/razorpay";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function POST(request, { params }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: payout, error: payoutError } = await supabase
    .from("campaign_payouts")
    .select("*, application:campaign_applications(*, campaign:campaigns(*))")
    .eq("id", id)
    .single();

  const campaign = payout?.application?.campaign;

  if (payoutError || !payout || !campaign || campaign.brand_id !== user.id) {
    return NextResponse.json({ error: "Payout not found" }, { status: 404 });
  }

  if (payout.status !== "held") {
    return NextResponse.json({ error: "Payout isn't in a releasable state." }, { status: 400 });
  }

  const admin = createAdminClient();

  try {
    await releaseTransferHold(payout.razorpay_transfer_id);

    const { error: updateError } = await admin
      .from("campaign_payouts")
      .update({ status: "released", released_at: new Date().toISOString() })
      .eq("id", id);

    if (updateError) throw updateError;

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Razorpay release hold failed", err);
    return NextResponse.json({ error: "Couldn't release the payment." }, { status: 502 });
  }
}
