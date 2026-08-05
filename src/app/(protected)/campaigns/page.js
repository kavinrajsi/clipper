import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveWorkspace } from "@/lib/workspaces";
import { withBrandInfo } from "@/lib/campaigns";
import { resolveView } from "@/lib/view-mode";
import { CampaignCard } from "@/components/campaign-card";
import { CampaignForm } from "@/components/campaign-form";
import { CampaignTable } from "@/components/campaign-table";
import { ViewToggle } from "@/components/view-toggle";

// A six-column table in max-w-3xl is unreadable, so the container widens for
// it. Cards stay at the narrower measure they were designed for.
function containerWidth(view) {
  return view === "table" ? "mx-auto w-full max-w-6xl" : "mx-auto w-full max-w-3xl";
}

export default async function CampaignsPage({ searchParams }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/campaigns");
  }

  // Next 16: both are Promises.
  const [params, cookieStore] = await Promise.all([searchParams, cookies()]);
  const view = resolveView(params?.view, cookieStore);

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const role = profile?.role ?? "clipper";

  if (role === "brand") {
    const workspace = await getActiveWorkspace(supabase, user);

    // Starters plus this workspace's own. RLS returns platform templates to
    // everyone and workspace ones only to members.
    const { data: templates } = await supabase
      .from("campaign_templates")
      .select("id, name, description, payload, is_platform_template")
      .order("is_platform_template", { ascending: true })
      .order("name", { ascending: true });

    const { data: campaigns } = workspace
      ? await supabase
          .from("campaigns")
          .select("*")
          .eq("workspace_id", workspace.id)
          .order("created_at", { ascending: false })
      : { data: [] };

    return (
      <div className="flex flex-1 flex-col gap-6 p-6">
        <div className={containerWidth(view)}>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Campaigns</h1>
              <p className="text-sm text-muted-foreground">
                Create and manage campaigns for clippers.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {/* ViewToggle calls useSearchParams, which has to be inside a
                  Suspense boundary or the build fails. */}
              <Suspense fallback={null}>
                <ViewToggle view={view} />
              </Suspense>
              <CampaignForm
                brandId={user.id}
                workspaceId={workspace?.id}
                templates={templates ?? []}
              />
            </div>
          </div>
          {view === "table" ? (
            <div className="mt-6">
              <CampaignTable campaigns={campaigns ?? []} role="brand" />
            </div>
          ) : (
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
          )}
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

  const [{ data: saves }, { data: portfolioItems }] = await Promise.all([
    supabase.from("saved_campaigns").select("campaign_id").eq("user_id", user.id),
    // Attachable work for the proposal form. Fetched once here rather than per
    // card — every card offers the same portfolio.
    supabase
      .from("portfolio_items")
      .select("id, title, thumbnail_url, view_count")
      .eq("user_id", user.id)
      .order("position", { ascending: true }),
  ]);
  const savedCampaignIds = new Set((saves ?? []).map((save) => save.campaign_id));

  const campaignsWithBrand = await withBrandInfo(supabase, campaigns);

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className={containerWidth(view)}>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Campaigns</h1>
            <p className="text-sm text-muted-foreground">
              Browse active campaigns and apply.
            </p>
          </div>
          <Suspense fallback={null}>
            <ViewToggle view={view} />
          </Suspense>
        </div>
        {view === "table" ? (
          <div className="mt-6">
            <CampaignTable
              campaigns={campaignsWithBrand}
              role="clipper"
              applicationByCampaign={applicationByCampaign}
              savedCampaignIds={savedCampaignIds}
              portfolioItems={portfolioItems ?? []}
            />
          </div>
        ) : (
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {campaignsWithBrand.map((campaign) => (
              <CampaignCard
                key={campaign.id}
                campaign={campaign}
                role="clipper"
                applicationStatus={applicationByCampaign[campaign.id]}
                saved={savedCampaignIds.has(campaign.id)}
                portfolioItems={portfolioItems ?? []}
              />
            ))}
            {campaignsWithBrand.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No active campaigns right now — check back soon.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
