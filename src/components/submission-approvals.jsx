"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2Icon, UndoIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/format";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

// Sign-off, separate from approving the payout itself.
//
// The threshold is enforced in the approve route before any Razorpay call —
// this is the surface that lets a second person actually meet it. Without it a
// workspace could set a 2-approval policy and then have no way to satisfy it.
export function SubmissionApprovals({
  workspaceId,
  submissionId,
  approvals,
  required,
  thresholdAmount,
  viewerId,
  people,
}) {
  const supabase = createClient();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (required <= 1) return null;

  // Read straight from the prop rather than seeding local state: a teammate's
  // approval arrives via the parent's refresh, and useState would ignore it.
  // Showing "1 of 2" when the server already has 2 is the one thing this panel
  // must not do.
  const mine = approvals.find((a) => a.approver_id === viewerId);
  const count = approvals.filter((a) => a.decision === "approved").length;
  const cleared = count >= required;

  async function approve() {
    setBusy(true);
    setError(null);

    const { error: writeError } = await supabase.from("approvals").insert({
      workspace_id: workspaceId,
      subject_type: "submission",
      subject_id: submissionId,
      approver_id: viewerId,
      decision: "approved",
    });

    setBusy(false);
    if (writeError) {
      setError(
        writeError.code === "23505"
          ? "You've already approved this."
          : writeError.message
      );
      return;
    }

    toast.success("Approved.");
    router.refresh();
  }

  async function withdraw() {
    setBusy(true);
    setError(null);

    const { error: writeError } = await supabase
      .from("approvals")
      .delete()
      .eq("subject_type", "submission")
      .eq("subject_id", submissionId)
      .eq("approver_id", viewerId);

    setBusy(false);
    if (writeError) {
      setError(writeError.message);
      return;
    }

    toast.success("Approval withdrawn.");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={cleared ? "default" : "secondary"}>
          {count} of {required} approvals
        </Badge>
        {cleared ? (
          <span className="text-sm text-muted-foreground">
            Cleared — a payout can be created.
          </span>
        ) : thresholdAmount ? (
          // The exact payout is computed server-side from the agreed rate,
          // view count and verification multiplier, so this cannot say which
          // side of the threshold this submission falls on without guessing.
          // State the rule instead of predicting the outcome.
          <span className="text-sm text-muted-foreground">
            Payouts of {formatCurrency(thresholdAmount)} or more need {required} approvals.
            Smaller ones need one.
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">
            {required - count} more needed before a payout can be created.
          </span>
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {approvals.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Approved by{" "}
          {approvals
            .map((a) => people[a.approver_id]?.full_name ?? "a teammate")
            .join(", ")}
        </p>
      )}

      <div className="flex gap-2">
        {mine ? (
          <Button variant="outline" size="sm" onClick={withdraw} disabled={busy}>
            {busy ? <Spinner /> : <UndoIcon />}
            Withdraw approval
          </Button>
        ) : (
          <Button size="sm" onClick={approve} disabled={busy}>
            {busy ? <Spinner /> : <CheckCircle2Icon />}
            Approve
          </Button>
        )}
      </div>
    </div>
  );
}
