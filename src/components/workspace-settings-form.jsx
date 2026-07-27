"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

export function WorkspaceSettingsForm({ workspace, policy, memberCount, canManage }) {
  const supabase = createClient();
  const router = useRouter();

  const [name, setName] = useState(workspace.name ?? "");
  const [approvals, setApprovals] = useState(policy?.submission_approvals_required ?? 1);
  const [threshold, setThreshold] = useState(policy?.approval_threshold_amount ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // A policy requiring more approvals than there are people can never be
  // satisfied, so the form refuses to save one.
  const tooManyApprovals = Number(approvals) > memberCount;

  async function save(event) {
    event.preventDefault();
    setError(null);

    if (tooManyApprovals) {
      setError(
        `This workspace has ${memberCount} member${memberCount === 1 ? "" : "s"}, so ${approvals} approvals could never be reached.`
      );
      return;
    }

    setSaving(true);

    const { error: nameError } = await supabase
      .from("workspaces")
      .update({ name, updated_at: new Date().toISOString() })
      .eq("id", workspace.id);

    if (nameError) {
      setSaving(false);
      setError(nameError.message);
      return;
    }

    const { error: policyError } = await supabase.from("approval_policies").upsert(
      {
        workspace_id: workspace.id,
        submission_approvals_required: Number(approvals),
        approval_threshold_amount: threshold === "" ? null : Number(threshold),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id" }
    );

    setSaving(false);
    if (policyError) {
      setError(policyError.message);
      return;
    }

    toast.success("Workspace settings saved.");
    router.refresh();
  }

  return (
    <form onSubmit={save}>
      <FieldGroup>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <FieldSet>
          <FieldLegend>Workspace</FieldLegend>
          <Field>
            <FieldLabel htmlFor="ws-name">Name</FieldLabel>
            <Input
              id="ws-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={!canManage}
              required
            />
            <FieldDescription>
              What your team and invited creators see. Campaigns belong to the workspace, not to
              whoever created them.
            </FieldDescription>
          </Field>
        </FieldSet>

        <FieldSeparator />

        <FieldSet>
          <FieldLegend>Approvals</FieldLegend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="approvals">Approvals needed per payout</FieldLabel>
              <Input
                id="approvals"
                type="number"
                min="1"
                max="10"
                value={approvals}
                onChange={(event) => setApprovals(event.target.value)}
                disabled={!canManage}
              />
              <FieldDescription>
                {Number(approvals) <= 1
                  ? "One approval — anyone who can review can create a payout."
                  : `${approvals} different people must approve before a payout is created.`}
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="threshold">Skip below (INR)</FieldLabel>
              <Input
                id="threshold"
                type="number"
                min="0"
                step="0.01"
                value={threshold}
                onChange={(event) => setThreshold(event.target.value)}
                placeholder="No exception"
                disabled={!canManage}
              />
              <FieldDescription>
                Payouts under this amount need only one approval. Leave blank to apply the rule to
                everything.
              </FieldDescription>
            </Field>
          </div>
          {tooManyApprovals && (
            <Alert variant="destructive">
              <AlertDescription>
                Only {memberCount} member{memberCount === 1 ? "" : "s"} in this workspace — invite
                more people before requiring {approvals} approvals.
              </AlertDescription>
            </Alert>
          )}
        </FieldSet>

        {canManage && (
          <div className="mt-2 flex justify-end border-t pt-6">
            <Button type="submit" disabled={saving || tooManyApprovals}>
              {saving && <Spinner />}
              Save settings
            </Button>
          </div>
        )}
      </FieldGroup>
    </form>
  );
}
