import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CampaignApplicationsList } from "@/components/campaign-applications-list";
import { Badge } from "@/components/ui/badge";

export default async function CampaignDetailPage({ params }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=/campaigns/${id}`);
  }

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", id)
    .single();

  if (!campaign || campaign.brand_id !== user.id) {
    redirect("/campaigns");
  }

  const { data: applications } = await supabase
    .from("campaign_applications")
    .select("*")
    .eq("campaign_id", id)
    .order("created_at", { ascending: true });

  const clipperIds = [...new Set((applications ?? []).map((application) => application.clipper_id))];
  const applicationIds = (applications ?? []).map((application) => application.id);

  let clipperProfiles = [];
  if (clipperIds.length > 0) {
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name, avatar_url")
      .in("id", clipperIds);
    clipperProfiles = data ?? [];
  }

  let submissions = [];
  let payouts = [];
  if (applicationIds.length > 0) {
    const { data: submissionsData } = await supabase
      .from("campaign_submissions")
      .select("*")
      .in("application_id", applicationIds)
      .order("created_at", { ascending: true });
    submissions = submissionsData ?? [];

    const { data: payoutsData } = await supabase
      .from("campaign_payouts")
      .select("*")
      .in("application_id", applicationIds);
    payouts = payoutsData ?? [];
  }

  const profileById = Object.fromEntries(clipperProfiles.map((profile) => [profile.id, profile]));
  const submissionByApplication = Object.fromEntries(
    submissions.map((submission) => [submission.application_id, submission])
  );
  const payoutByApplication = Object.fromEntries(
    payouts.map((payout) => [payout.application_id, payout])
  );

  const applicationsWithClipper = (applications ?? []).map((application) => ({
    ...application,
    clipper: profileById[application.clipper_id],
    submission: submissionByApplication[application.id],
    payout: payoutByApplication[application.id],
  }));

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">{campaign.title}</h1>
          <Badge variant="outline">{campaign.status}</Badge>
        </div>
        {campaign.description && (
          <p className="mt-1 text-sm text-muted-foreground">{campaign.description}</p>
        )}
      </div>
      <div>
        <h2 className="mb-3 text-lg font-semibold">Applicants</h2>
        <CampaignApplicationsList applications={applicationsWithClipper} />
      </div>
    </div>
  );
}
