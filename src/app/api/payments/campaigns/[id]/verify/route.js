import { NextResponse } from "next/server";
import { verifyPaymentSignature } from "@/lib/razorpay";
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

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = await request.json();

  const access = await requireCampaignAccess(supabase, user, id, MONEY_ROLES);

  if (!access) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const { campaign } = access;

  if (campaign.razorpay_order_id !== razorpay_order_id) {
    return NextResponse.json({ error: "Order mismatch." }, { status: 400 });
  }

  const isValid = verifyPaymentSignature(
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature
  );

  if (!isValid) {
    await supabase
      .from("campaigns")
      .update({ funding_status: "failed", updated_at: new Date().toISOString() })
      .eq("id", id);
    return NextResponse.json({ error: "Payment verification failed." }, { status: 400 });
  }

  const { error: updateError } = await supabase
    .from("campaigns")
    .update({
      razorpay_payment_id,
      funding_status: "paid",
      status: "active",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (updateError) {
    return NextResponse.json({ error: "Payment verified but failed to save." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
