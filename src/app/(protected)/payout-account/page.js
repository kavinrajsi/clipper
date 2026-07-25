import { redirect } from "next/navigation";
import { isSuperAdmin } from "@/lib/admin";
import { requireRole } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { PayoutAccountForm } from "@/components/payout-account-form";

export default async function PayoutAccountPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/payout-account");
  }

  if (!isSuperAdmin(user)) {
    await requireRole(supabase, user, "clipper", "/campaigns");
  }

  const { data: payoutAccount } = await supabase
    .from("clipper_payout_accounts")
    .select("*")
    .eq("user_id", user.id)
    .single();

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="mx-auto w-full max-w-3xl">
        <h1 className="text-2xl font-bold">Payout Account</h1>
        <p className="text-sm text-muted-foreground">
          Required before you can receive campaign payouts. Bank details and PAN are sent to
          Razorpay to verify and set up your linked account.
        </p>
      </div>
      <PayoutAccountForm
        user={user}
        payoutAccount={payoutAccount}
        className="mx-auto w-full max-w-3xl"
      />
    </div>
  );
}
