import { NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/lib/razorpay";
import { createAdminClient } from "@/lib/supabase/admin";

// Auth for this route is the signature check below, not isSuperAdmin() —
// Razorpay is the caller, not a logged-in user.
export async function POST(request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-razorpay-signature");

  if (!signature || !verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const event = JSON.parse(rawBody);
  const admin = createAdminClient();

  switch (event.event) {
    case "payment.captured": {
      const payment = event.payload.payment.entity;
      const orderId = payment.order_id;

      // .neq guard makes redelivery of the same event a no-op.
      await admin
        .from("campaigns")
        .update({
          razorpay_payment_id: payment.id,
          funding_status: "paid",
          status: "active",
          updated_at: new Date().toISOString(),
        })
        .eq("razorpay_order_id", orderId)
        .neq("funding_status", "paid");
      break;
    }
    case "account.activated":
    case "account.under_review":
    case "account.needs_clarification": {
      const account = event.payload.account.entity;
      const statusMap = {
        "account.activated": "active",
        "account.under_review": "under_review",
        "account.needs_clarification": "under_review",
      };

      await admin
        .from("clipper_payout_accounts")
        .update({ status: statusMap[event.event], updated_at: new Date().toISOString() })
        .eq("razorpay_account_id", account.id);
      break;
    }
    default:
      break;
  }

  return NextResponse.json({ ok: true });
}
