import { NextResponse } from "next/server";
import { checkAccountActivation } from "@/lib/razorpay";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const STATUS_MAP = {
  activated: "active",
  under_review: "under_review",
  needs_clarification: "under_review",
  rejected: "failed",
};

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: payoutAccount } = await supabase
    .from("clipper_payout_accounts")
    .select("razorpay_account_id, razorpay_product_id, status")
    .eq("user_id", user.id)
    .single();

  if (!payoutAccount?.razorpay_account_id || !payoutAccount?.razorpay_product_id) {
    return NextResponse.json({ status: payoutAccount?.status ?? null });
  }

  try {
    const { activationStatus } = await checkAccountActivation(
      payoutAccount.razorpay_account_id,
      payoutAccount.razorpay_product_id
    );
    const mappedStatus = STATUS_MAP[activationStatus] ?? "pending";

    // Razorpay's activation verdict — server-owned, and guarded against
    // authenticated writes, so this needs the service-role client. Ownership
    // was established by the user_id-scoped read above.
    await createAdminClient()
      .from("clipper_payout_accounts")
      .update({
        status: mappedStatus,
        activation_status: activationStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", user.id);

    return NextResponse.json({ status: mappedStatus });
  } catch (err) {
    console.error("Razorpay account activation check failed", err);
    return NextResponse.json({ error: "Couldn't check activation status." }, { status: 502 });
  }
}
