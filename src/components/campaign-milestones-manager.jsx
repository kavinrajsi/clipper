"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PlusIcon, XIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDate } from "@/lib/format";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";

const PAYOUT_STATE = {
  held: "Held",
  released: "Paid",
  failed: "Failed",
  pending: "Pending",
};

export function CampaignMilestonesManager({ campaign, milestones, payouts, canManage }) {
  const supabase = createClient();
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState(null);

  const committed = milestones.reduce((sum, m) => sum + Number(m.amount), 0);
  const budget = Number(campaign.budget ?? 0);
  const remaining = budget - committed;
  const payoutByMilestone = Object.fromEntries(
    payouts.filter((p) => p.milestone_id).map((p) => [p.milestone_id, p])
  );

  // Milestones are locked once funded — the budget backing them is already
  // captured, so changing the split afterwards would strand money.
  const locked = campaign.funding_status === "paid";

  async function add(event) {
    event.preventDefault();
    setError(null);
    setAdding(true);

    const { error: writeError } = await supabase.from("campaign_milestones").insert({
      campaign_id: campaign.id,
      title,
      amount: Number(amount),
      due_date: dueDate || null,
      position: milestones.length,
    });

    setAdding(false);
    if (writeError) {
      setError(
        writeError.message?.includes("exceeds the campaign budget")
          ? `That would take the milestones past the ${formatCurrency(budget)} budget. ${formatCurrency(remaining)} left to allocate.`
          : writeError.message
      );
      return;
    }

    setTitle("");
    setAmount("");
    setDueDate("");
    toast.success("Milestone added.");
    router.refresh();
  }

  async function remove(milestone) {
    setBusyId(milestone.id);
    setError(null);

    const { error: writeError } = await supabase
      .from("campaign_milestones")
      .delete()
      .eq("id", milestone.id);

    setBusyId(null);
    if (writeError) {
      setError(writeError.message);
      return;
    }
    toast.success("Milestone removed.");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {milestones.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <PlusIcon />
            </EmptyMedia>
            <EmptyTitle>No milestones</EmptyTitle>
            <EmptyDescription>
              This campaign pays out in one go. Split it into milestones if the work is staged —
              the creator gets paid as each part lands, instead of waiting for all of it.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Allocated</span>
              <span className="tabular-nums">
                {formatCurrency(committed)} of {formatCurrency(budget)}
              </span>
            </div>
            <Progress value={budget > 0 ? (committed / budget) * 100 : 0} />
          </div>

          <ul className="flex flex-col gap-2">
            {milestones.map((milestone) => {
              const payout = payoutByMilestone[milestone.id];
              return (
                <li key={milestone.id} className="flex items-center gap-3 rounded-lg border p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{milestone.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatCurrency(milestone.amount)}
                      {milestone.due_date
                        ? ` · due ${formatDate(milestone.due_date, { style: "medium" })}`
                        : ""}
                      {payout ? ` · ${PAYOUT_STATE[payout.status] ?? payout.status}` : ""}
                    </p>
                  </div>
                  {canManage && !locked && !payout && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${milestone.title}`}
                      disabled={busyId === milestone.id}
                      onClick={() => remove(milestone)}
                    >
                      {busyId === milestone.id ? <Spinner /> : <XIcon />}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {canManage && !locked && (
        <form onSubmit={add} className="flex flex-col gap-3 rounded-lg border p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field className="sm:col-span-1">
              <FieldLabel htmlFor="ms-title">Milestone</FieldLabel>
              <Input
                id="ms-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="First 3 clips"
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="ms-amount">Amount (INR)</FieldLabel>
              <Input
                id="ms-amount"
                type="number"
                min="1"
                step="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="ms-due">Due</FieldLabel>
              <Input
                id="ms-due"
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </Field>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground tabular-nums">
              {formatCurrency(remaining)} left to allocate
            </p>
            <Button type="submit" size="sm" disabled={adding || !title || !amount}>
              {adding && <Spinner />}
              <PlusIcon />
              Add milestone
            </Button>
          </div>
        </form>
      )}

      {locked && milestones.length > 0 && (
        <p className="text-xs text-muted-foreground">
          This campaign is funded, so the milestone split is locked — the budget behind it is
          already captured.
        </p>
      )}
    </div>
  );
}
