import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CampaignCard } from "@/components/campaign-card";
import { CampaignForm } from "@/components/campaign-form";

export default async function CampaignsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/campaigns");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const role = profile?.role ?? "clipper";

  if (role === "brand") {
    const { data: campaigns } = await supabase
      .from("campaigns")
      .select("*")
      .eq("brand_id", user.id)
      .order("created_at", { ascending: false });

    return (
      <div className="flex flex-1 flex-col gap-6 p-6">
        <div className="mx-auto w-full max-w-3xl">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Campaigns</h1>
              <p className="text-sm text-muted-foreground">
                Create and manage campaigns for clippers.
              </p>
            </div>
            <CampaignForm brandId={user.id} />
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {(campaigns ?? []).map((campaign) => (
              <CampaignCard key={campaign.id} campaign={campaign} role="brand" />
            ))}
            {(campaigns ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">
                No campaigns yet — create one to get started.
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("*")
    .eq("status", "active")
    .eq("funding_status", "paid")
    .order("created_at", { ascending: false });

  const { data: applications } = await supabase
    .from("campaign_applications")
    .select("campaign_id, status")
    .eq("clipper_id", user.id);

  const applicationByCampaign = Object.fromEntries(
    (applications ?? []).map((application) => [application.campaign_id, application.status])
  );

  const brandIds = [...new Set((campaigns ?? []).map((campaign) => campaign.brand_id))];

  let brandProfiles = [];
  let brandProfileNames = [];
  if (brandIds.length > 0) {
    const [{ data: brandProfilesData }, { data: brandProfileNamesData }] = await Promise.all([
      supabase.from("brand_profiles").select("user_id, company_name, logo_url").in("user_id", brandIds),
      supabase.from("profiles").select("id, full_name").in("id", brandIds),
    ]);
    brandProfiles = brandProfilesData ?? [];
    brandProfileNames = brandProfileNamesData ?? [];
  }

  const brandProfileById = Object.fromEntries(
    brandProfiles.map((brandProfile) => [brandProfile.user_id, brandProfile])
  );
  const brandNameById = Object.fromEntries(
    brandProfileNames.map((profile) => [profile.id, profile.full_name])
  );

  const campaignsWithBrand = (campaigns ?? []).map((campaign) => ({
    ...campaign,
    brand_name: brandProfileById[campaign.brand_id]?.company_name ?? brandNameById[campaign.brand_id],
    brand_logo_url: brandProfileById[campaign.brand_id]?.logo_url,
  }));

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="mx-auto w-full max-w-3xl">
        <div>
          <h1 className="text-2xl font-bold">Campaigns</h1>
          <p className="text-sm text-muted-foreground">
            Browse active campaigns and apply.
          </p>
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {campaignsWithBrand.map((campaign) => (
            <CampaignCard
              key={campaign.id}
              campaign={campaign}
              role="clipper"
              applicationStatus={applicationByCampaign[campaign.id]}
              saved={savedCampaignIds.has(campaign.id)}
            />
          ))}
          {(campaigns ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">
              No active campaigns right now — check back soon.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
