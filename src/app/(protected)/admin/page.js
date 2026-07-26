import { redirect } from "next/navigation";
import { isSuperAdmin } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { AdminBrandsTable } from "@/components/admin-brands-table";
import { AdminCampaignsTable } from "@/components/admin-campaigns-table";
import { AdminClippersTable } from "@/components/admin-clippers-table";
import { AdminPayoutsTable } from "@/components/admin-payouts-table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!isSuperAdmin(user)) {
    redirect("/dashboard");
  }

  const admin = createAdminClient();

  const [
    { data: usersResult },
    { data: profiles },
    { data: connections },
    { data: stats },
    { data: clipperProfiles },
    { data: brandProfiles },
    { data: campaigns },
    { data: applications },
    { data: payouts },
  ] = await Promise.all([
    admin.auth.admin.listUsers({ perPage: 1000 }),
    admin.from("profiles").select("id, full_name, role"),
    admin.from("youtube_connections").select("user_id, channel_title, last_synced_at"),
    admin.from("youtube_channel_stats_daily").select("user_id, views"),
    admin
      .from("clipper_profiles")
      .select("user_id, bio, categories, style_tags, pricing_model, rate_amount, availability_status"),
    admin
      .from("brand_profiles")
      .select("user_id, website, industry, description, logo_url, font_name, color_code"),
    admin
      .from("campaigns")
      .select(
        "id, title, description, requirements, status, payout_structure, payout_rate, budget, deadline, funding_status, created_at, brand_id"
      ),
    admin.from("campaign_applications").select("id, campaign_id"),
    admin
      .from("campaign_payouts")
      .select(
        "id, application_id, clipper_id, amount, platform_fee_amount, status, held_at, released_at, created_at"
      ),
  ]);

  const emailById = Object.fromEntries(
    (usersResult?.users ?? []).map((u) => [u.id, u.email])
  );
  const profileById = Object.fromEntries((profiles ?? []).map((p) => [p.id, p]));
  const connectionByUser = Object.fromEntries(
    (connections ?? []).map((c) => [c.user_id, c])
  );
  const clipperProfileByUser = Object.fromEntries(
    (clipperProfiles ?? []).map((c) => [c.user_id, c])
  );
  const brandProfileByUser = Object.fromEntries(
    (brandProfiles ?? []).map((b) => [b.user_id, b])
  );
  const viewsByUser = (stats ?? []).reduce((acc, row) => {
    acc[row.user_id] = (acc[row.user_id] ?? 0) + (row.views ?? 0);
    return acc;
  }, {});
  const applicationCountByCampaign = (applications ?? []).reduce((acc, row) => {
    acc[row.campaign_id] = (acc[row.campaign_id] ?? 0) + 1;
    return acc;
  }, {});

  const clippers = (profiles ?? [])
    .filter((p) => p.role === "clipper")
    .map((p) => ({
      id: p.id,
      full_name: p.full_name,
      email: emailById[p.id],
      channel_title: connectionByUser[p.id]?.channel_title,
      last_synced_at: connectionByUser[p.id]?.last_synced_at,
      total_views: viewsByUser[p.id] ?? 0,
      bio: clipperProfileByUser[p.id]?.bio,
      categories: clipperProfileByUser[p.id]?.categories ?? [],
      style_tags: clipperProfileByUser[p.id]?.style_tags ?? [],
      pricing_model: clipperProfileByUser[p.id]?.pricing_model,
      rate_amount: clipperProfileByUser[p.id]?.rate_amount,
      availability_status: clipperProfileByUser[p.id]?.availability_status,
    }));

  const brands = (profiles ?? [])
    .filter((p) => p.role === "brand")
    .map((p) => ({
      id: p.id,
      full_name: p.full_name,
      email: emailById[p.id],
      campaign_count: (campaigns ?? []).filter((c) => c.brand_id === p.id).length,
      website: brandProfileByUser[p.id]?.website,
      industry: brandProfileByUser[p.id]?.industry,
      description: brandProfileByUser[p.id]?.description,
      logo_url: brandProfileByUser[p.id]?.logo_url,
      font_name: brandProfileByUser[p.id]?.font_name,
      color_code: brandProfileByUser[p.id]?.color_code,
    }));

  const campaignsWithDetail = (campaigns ?? []).map((c) => ({
    ...c,
    brand_name: profileById[c.brand_id]?.full_name,
    brand_email: emailById[c.brand_id],
    applicant_count: applicationCountByCampaign[c.id] ?? 0,
  }));

  const campaignById = Object.fromEntries((campaigns ?? []).map((c) => [c.id, c]));
  const applicationById = Object.fromEntries((applications ?? []).map((a) => [a.id, a]));

  const payoutsWithDetail = (payouts ?? []).map((p) => {
    const application = applicationById[p.application_id];
    const campaign = application ? campaignById[application.campaign_id] : undefined;
    return {
      ...p,
      clipper_name: profileById[p.clipper_id]?.full_name,
      clipper_email: emailById[p.clipper_id],
      campaign_title: campaign?.title,
    };
  });

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Admin</h1>
        <p className="text-sm text-muted-foreground">
          Full cross-account view — clippers, brands, campaigns, and payments.
        </p>
      </div>
      <Tabs defaultValue="clippers">
        <TabsList>
          <TabsTrigger value="clippers">Clippers</TabsTrigger>
          <TabsTrigger value="brands">Brands</TabsTrigger>
          <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
        </TabsList>
        <TabsContent value="clippers" className="mt-4">
          <AdminClippersTable clippers={clippers} />
        </TabsContent>
        <TabsContent value="brands" className="mt-4">
          <AdminBrandsTable brands={brands} />
        </TabsContent>
        <TabsContent value="campaigns" className="mt-4">
          <AdminCampaignsTable campaigns={campaignsWithDetail} />
        </TabsContent>
        <TabsContent value="payments" className="mt-4">
          <AdminPayoutsTable payouts={payoutsWithDetail} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
