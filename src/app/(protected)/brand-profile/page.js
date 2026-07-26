import { redirect } from "next/navigation";
import { isSuperAdmin } from "@/lib/admin";
import { requireRole } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { BrandProfileForm } from "@/components/brand-profile-form";

export default async function BrandProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/brand-profile");
  }

  if (!isSuperAdmin(user)) {
    await requireRole(supabase, user, "brand", "/dashboard");
  }

  const { data: brandProfile } = await supabase
    .from("brand_profiles")
    .select("*")
    .eq("user_id", user.id)
    .single();

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="mx-auto w-full max-w-3xl">
        <h1 className="text-2xl font-bold">Brand Profile</h1>
        <p className="text-sm text-muted-foreground">
          Details clippers see when browsing your campaigns.
        </p>
      </div>
      <BrandProfileForm
        userId={user.id}
        brandProfile={brandProfile}
        className="mx-auto w-full max-w-3xl"
      />
    </div>
  );
}
