import { redirect } from "next/navigation";
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

  const { data: brandProfile } = await supabase
    .from("brand_profiles")
    .select("*")
    .eq("user_id", user.id)
    .single();

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Brand Profile</h1>
        <p className="text-sm text-muted-foreground">
          Details clippers see when browsing your campaigns.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <BrandProfileForm userId={user.id} brandProfile={brandProfile} />
      </div>
    </div>
  );
}
