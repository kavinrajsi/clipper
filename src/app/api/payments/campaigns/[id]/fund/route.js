import { NextResponse } from "next/server";
import { createOrder } from "@/lib/razorpay";
import { createClient } from "@/lib/supabase/server";
import { MONEY_ROLES, requireCampaignAccess } from "@/lib/workspaces";

export async function POST(request, { params }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Funding moves money, so membership alone is not enough — a `member` can
  // run a campaign but cannot pay for it.
  const access = await requireCampaignAccess(supabase, user, id, MONEY_ROLES);

  if (!access) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const { campaign } = access;

  if (!campaign.budget || campaign.budget <= 0) {
    return NextResponse.json({ error: "Set a budget before funding this campaign." }, { status: 400 });
  }

  try {
    const order = await createOrder(campaign.budget, campaign.id);

    const { error: updateError } = await supabase
      .from("campaigns")
      .update({
        razorpay_order_id: order.id,
        funding_status: "created",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (updateError) throw updateError;

    return NextResponse.json({
      orderId: order.id,
      amount: order.amount,
      keyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
      campaignTitle: campaign.title,
    });
  } catch (err) {
    console.error("Razorpay order creation failed", err);
    await supabase
      .from("campaigns")
      .update({ funding_status: "failed", updated_at: new Date().toISOString() })
      .eq("id", id);
    return NextResponse.json({ error: "Couldn't start payment. Try again." }, { status: 502 });
  }
}
