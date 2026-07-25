import { NextResponse } from "next/server";
import { createOrder } from "@/lib/razorpay";
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

  const { data: campaign, error: campaignError } = await supabase
    .from("campaigns")
    .select("id, title, brand_id, budget, funding_status")
    .eq("id", id)
    .single();

  if (campaignError || !campaign || campaign.brand_id !== user.id) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

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
