// Shared campaign presentation bits.
//
// Plain module, deliberately not "use client": campaign-table.jsx is a Server
// Component and importing a client module would drag it over the boundary.

export const CAMPAIGN_STATUS_OPTIONS = [
  { label: "Draft", value: "draft" },
  { label: "Active", value: "active" },
  { label: "Completed", value: "completed" },
  { label: "Cancelled", value: "cancelled" },
];

export const CAMPAIGN_STATUS_VARIANT = {
  draft: "secondary",
  active: "default",
  completed: "outline",
  cancelled: "destructive",
};

export const APPLICATION_LABEL = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};

// A campaign can only be activated once it is funded.
export function campaignStatusOptions(campaign) {
  return campaign.funding_status === "paid"
    ? CAMPAIGN_STATUS_OPTIONS
    : CAMPAIGN_STATUS_OPTIONS.filter((option) => option.value !== "active");
}

// Attaches brand_name / brand_logo_url to campaigns for the clipper-facing
// views.
//
// There is no FK from campaigns to brand_profiles that PostgREST can embed, and
// the display name falls back from the company name to the person's name, so
// this is two lookups merged in JS rather than one join.
//
// Lives here because /campaigns did it inline and /saved did not — invisible in
// card view, where CampaignCard hides the brand line when brand_name is
// missing, but a column of blanks in a table.
export async function withBrandInfo(supabase, campaigns) {
  const list = campaigns ?? [];
  const brandIds = [...new Set(list.map((campaign) => campaign.brand_id))];
  if (brandIds.length === 0) return list;

  const [{ data: brandProfiles }, { data: accounts }] = await Promise.all([
    supabase
      .from("brand_profiles")
      .select("user_id, company_name, logo_url")
      .in("user_id", brandIds),
    supabase.from("profiles").select("id, full_name").in("id", brandIds),
  ]);

  const brandProfileById = Object.fromEntries(
    (brandProfiles ?? []).map((brandProfile) => [brandProfile.user_id, brandProfile])
  );
  const nameById = Object.fromEntries(
    (accounts ?? []).map((account) => [account.id, account.full_name])
  );

  return list.map((campaign) => ({
    ...campaign,
    brand_name:
      brandProfileById[campaign.brand_id]?.company_name ?? nameById[campaign.brand_id],
    brand_logo_url: brandProfileById[campaign.brand_id]?.logo_url,
  }));
}
