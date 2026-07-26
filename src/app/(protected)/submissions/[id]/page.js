import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { extractYoutubeVideoId } from "@/lib/youtube";
import { SubmissionReview } from "@/components/submission-review";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default async function SubmissionReviewPage({ params }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=/submissions/${id}`);
  }

  // RLS limits this to the submitting clipper and the campaign's workspace, so
  // an inaccessible submission is indistinguishable from a missing one.
  const { data: submission } = await supabase
    .from("campaign_submissions")
    .select("*, application:campaign_applications(id, clipper_id, campaign:campaigns(id, title))")
    .eq("id", id)
    .maybeSingle();

  if (!submission) notFound();

  const { data: annotationRows } = await supabase
    .from("annotations")
    .select("*")
    .eq("submission_id", id)
    .order("start_seconds", { ascending: true });

  const annotations = annotationRows ?? [];
  const authorIds = [...new Set(annotations.map((a) => a.author_id))];

  let profiles = [];
  if (authorIds.length > 0) {
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name, avatar_url")
      .in("id", authorIds);
    profiles = data ?? [];
  }
  const people = Object.fromEntries(profiles.map((p) => [p.id, p]));
  const campaign = submission.application?.campaign;

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="mx-auto w-full max-w-5xl">
        <div className="flex items-center gap-3">
          {campaign && (
            <Button
              variant="ghost"
              size="icon"
              nativeButton={false}
              render={<Link href={`/campaigns/${campaign.id}`} />}
              aria-label="Back to campaign"
            >
              <ArrowLeftIcon />
            </Button>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold">{campaign?.title ?? "Submission"}</h1>
            <p className="text-sm text-muted-foreground">
              Submitted {formatDate(submission.created_at, { style: "medium" })}
            </p>
          </div>
          <Badge variant="outline" className="ml-auto">
            {submission.status}
          </Badge>
        </div>
      </div>

      <div className="mx-auto w-full max-w-5xl">
        <SubmissionReview
          submission={submission}
          videoId={extractYoutubeVideoId(submission.video_url)}
          annotations={annotations}
          viewerId={user.id}
          people={people}
        />
      </div>
    </div>
  );
}
