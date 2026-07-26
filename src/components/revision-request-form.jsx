"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/format";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

const STATE_LABEL = {
  submitted: "Awaiting review",
  in_review: "In review",
  revision_requested: "Changes requested",
  approved: "Approved",
  rejected: "Superseded",
};

export function RevisionRequestForm({
  submission,
  revisionRequests,
  versions,
  canRequest,
  unresolvedCount,
}) {
  const supabase = createClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(event) {
    event.preventDefault();
    const text = notes.trim();
    if (!text) return;

    setBusy(true);
    setError(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { error: writeError } = await supabase.from("revision_requests").insert({
      submission_id: submission.id,
      requested_by: user.id,
      notes: text,
    });

    setBusy(false);
    if (writeError) {
      // The trigger blocks a revision once a payout exists — that is a dispute,
      // not a revision, and the raw error explains none of it.
      setError(
        writeError.message?.includes("dispute")
          ? "A payout already exists for this clip, so changes can't be requested. Raise it as a dispute instead."
          : writeError.message
      );
      return;
    }

    setNotes("");
    setOpen(false);
    toast.success("Changes requested.");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">Version {submission.revision_number}</Badge>
        <Badge variant={submission.delivery_state === "approved" ? "default" : "secondary"}>
          {STATE_LABEL[submission.delivery_state] ?? submission.delivery_state}
        </Badge>
        {versions.length > 1 && (
          <span className="text-xs text-muted-foreground">
            {versions.length} versions submitted
          </span>
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {revisionRequests.length > 0 && (
        <div className="flex flex-col gap-2">
          {revisionRequests.map((request) => (
            <div key={request.id} className="rounded-md border-l-2 border-primary bg-muted/40 p-3">
              <p className="text-sm whitespace-pre-wrap">{request.notes}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Requested {formatDate(request.created_at, { style: "medium" })}
              </p>
            </div>
          ))}
        </div>
      )}

      {canRequest && submission.delivery_state !== "approved" && (
        <>
          {open ? (
            <form onSubmit={submit} className="flex flex-col gap-2">
              <Textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={4}
                autoFocus
                placeholder="What needs to change? Timestamped notes above carry over — this is the summary."
              />
              {unresolvedCount > 0 && (
                <p className="text-xs text-muted-foreground">
                  {unresolvedCount} unresolved timestamped note
                  {unresolvedCount === 1 ? "" : "s"} will go with this.
                </p>
              )}
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={busy || !notes.trim()}>
                  {busy && <Spinner />}
                  Request changes
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setOpen(true)} className="w-fit">
              Request changes
            </Button>
          )}
        </>
      )}
    </div>
  );
}
