import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { extractYoutubeVideoId } from "@/lib/youtube";
import { getWorkspaceRole } from "@/lib/workspaces";
import { SubmissionApprovals } from "@/components/submission-approvals";
import { SubmissionReview } from "@/components/submission-review";
import { RevisionRequestForm } from "@/components/revision-request-form";
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
    .select(
      "*, application:campaign_applications(id, clipper_id, campaign:campaigns(id, title, workspace_id))"
    )
    .eq("id", id)
    .maybeSingle();

  if (!submission) notFound();

  const { data: annotationRows } = await supabase
    .from("annotations")
    .select("*")
    .eq("submission_id", id)
    .order("start_seconds", { ascending: true });

  const annotations = annotationRows ?? [];
  const campaign = submission.application?.campaign;

  // Only the workspace can ask for changes; the creator answers with a new
  // version. RLS enforces it too — this just decides whether to show the form.
  const workspaceRole = campaign
    ? await getWorkspaceRole(supabase, user, campaign.workspace_id)
    : null;

  const [{ data: revisionRows }, { data: versionRows }, { data: policy }, { data: approvalRows }] =
    await Promise.all([
      supabase
        .from("revision_requests")
        .select("*")
        .eq("submission_id", id)
        .order("created_at", { ascending: false }),
      supabase
        .from("campaign_submissions")
        .select("id, revision_number, delivery_state, created_at")
        .eq("application_id", submission.application_id)
        .order("revision_number", { ascending: true }),
      // Both are workspace-member-only under RLS, so a clipper viewing their
      // own submission simply gets nothing back and the panel stays hidden.
      campaign
        ? supabase
            .from("approval_policies")
            .select("submission_approvals_required, approval_threshold_amount")
            .eq("workspace_id", campaign.workspace_id)
            .maybeSingle()
        : { data: null },
      supabase
        .from("approvals")
        .select("*")
        .eq("subject_type", "submission")
        .eq("subject_id", id),
    ]);

  const approvals = approvalRows ?? [];

  // One lookup for every name shown on the page — annotation authors and
  // approvers both.
  const personIds = [
    ...new Set([...annotations.map((a) => a.author_id), ...approvals.map((a) => a.approver_id)]),
  ];

  let profiles = [];
  if (personIds.length > 0) {
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name, avatar_url")
      .in("id", personIds);
    profiles = data ?? [];
  }
  const people = Object.fromEntries(profiles.map((p) => [p.id, p]));

  const unresolvedCount = annotations.filter((a) => !a.parent_id && !a.resolved_at).length;

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

      {workspaceRole && campaign && (
        <div className="mx-auto w-full max-w-5xl">
          <SubmissionApprovals
            workspaceId={campaign.workspace_id}
            submissionId={submission.id}
            approvals={approvals}
            required={policy?.submission_approvals_required ?? 1}
            thresholdAmount={policy?.approval_threshold_amount ?? null}
            viewerId={user.id}
            people={people}
          />
        </div>
      )}

      <div className="mx-auto w-full max-w-5xl">
        <RevisionRequestForm
          submission={submission}
          revisionRequests={revisionRows ?? []}
          versions={versionRows ?? []}
          canRequest={Boolean(workspaceRole)}
          unresolvedCount={unresolvedCount}
        />
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
