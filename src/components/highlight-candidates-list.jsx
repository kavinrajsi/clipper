"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { SparklesIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";

function clock(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function HighlightCandidatesList({ asset, candidates, canManage }) {
  const supabase = createClient();
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  const selectedCount = candidates.filter((c) => c.selected).length;

  async function handleDetect() {
    setRunning(true);
    setError(null);

    const response = await fetch(`/api/ai/assets/${asset.id}/highlights`, { method: "POST" });
    const result = await response.json().catch(() => null);
    setRunning(false);

    if (!response.ok) {
      setError(result?.error ?? "Could not analyse this recording.");
      return;
    }

    toast.success(`Found ${result.candidates} moments.`);
    router.refresh();
  }

  async function togglePick(candidate) {
    setBusyId(candidate.id);

    // A direct table write, unlike detection: `selected` is the one column a
    // member is allowed to change, and the trigger on the table is what makes
    // that safe rather than trust in this component.
    const { error: updateError } = await supabase
      .from("highlight_candidates")
      .update({ selected: !candidate.selected })
      .eq("id", candidate.id);

    setBusyId(null);

    if (updateError) {
      toast.error("Could not update that moment.");
      return;
    }

    router.refresh();
  }

  if (candidates.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SparklesIcon />
            </EmptyMedia>
            <EmptyTitle>No moments yet</EmptyTitle>
            <EmptyDescription>
              {asset.status === "ready"
                ? "Find the moments worth clipping, then pick the ones you want made."
                : "Transcribe this recording first — the moments are found from what was said."}
            </EmptyDescription>
          </EmptyHeader>

          {canManage && asset.status === "ready" ? (
            <Button onClick={handleDetect} disabled={running}>
              {running ? <Spinner /> : <SparklesIcon />}
              {running ? "Reading the transcript…" : "Find moments"}
            </Button>
          ) : null}
        </Empty>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {candidates.length} moments found
          {selectedCount > 0 ? ` · ${selectedCount} picked` : ""}
        </p>

        {canManage ? (
          <Button variant="outline" size="sm" onClick={handleDetect} disabled={running}>
            {running ? <Spinner /> : null}
            {running ? "Working…" : "Find again"}
          </Button>
        ) : null}
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <ul className="flex flex-col gap-3">
        {candidates.map((candidate) => (
          <li
            key={candidate.id}
            className={`flex gap-3 rounded-lg border p-4 ${candidate.selected ? "border-primary" : ""}`}
          >
            {canManage ? (
              <Checkbox
                checked={candidate.selected}
                onCheckedChange={() => togglePick(candidate)}
                disabled={busyId === candidate.id}
                aria-label={`Pick ${candidate.title ?? "this moment"}`}
              />
            ) : null}

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">
                  {clock(candidate.start_seconds)}–{clock(candidate.end_seconds)}
                </Badge>
                <p className="truncate text-sm font-medium">{candidate.title}</p>
              </div>

              {candidate.quote ? (
                <p className="mt-2 border-l-2 pl-3 text-sm italic text-muted-foreground">
                  “{candidate.quote}”
                </p>
              ) : null}

              {candidate.rationale ? (
                <p className="mt-2 text-sm text-muted-foreground">{candidate.rationale}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
