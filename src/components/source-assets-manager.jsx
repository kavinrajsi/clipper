"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FilmIcon, XIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  SOURCE_ASSETS_BUCKET,
  removeSourceAsset,
  signSourceAssetUrl,
} from "@/lib/storage";
import { formatDate } from "@/lib/format";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";

// Matches the bucket's own limit. The bucket is the real enforcement; this is
// here so a hopeless upload fails instantly instead of after an hour.
const MAX_BYTES = 5 * 1024 * 1024 * 1024;

const STATUS_LABELS = {
  uploaded: "Uploaded",
  transcribing: "Transcribing",
  analysing: "Analysing",
  ready: "Ready",
  failed: "Failed",
};

function humanSize(bytes) {
  if (!bytes) return "";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

function humanDuration(seconds) {
  if (!seconds) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function SourceAssetsManager({ workspaceId, assets, canManage }) {
  const supabase = createClient();
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  async function handleUpload(event) {
    const file = event.target.files?.[0];
    // Clearing the input means picking the same file twice in a row still
    // fires a change event.
    event.target.value = "";
    if (!file) return;

    if (file.size > MAX_BYTES) {
      setError(`${file.name} is larger than the 5 GB limit.`);
      return;
    }

    setError(null);
    setUploading(true);

    try {
      // Two steps on purpose. The server registers the row and mints a
      // one-shot signed URL; the file then goes straight from here to storage,
      // never through a function. A 90-minute recording would not survive the
      // round trip otherwise.
      const response = await fetch("/api/ai/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          filename: file.name,
          mimeType: file.type || null,
          sizeBytes: file.size,
        }),
      });

      const result = await response.json().catch(() => null);

      if (!response.ok || !result?.token) {
        throw new Error(result?.error ?? "Could not start the upload.");
      }

      const { error: uploadError } = await supabase.storage
        .from(SOURCE_ASSETS_BUCKET)
        .uploadToSignedUrl(result.path, result.token, file);

      if (uploadError) throw new Error(uploadError.message);

      toast.success(`${file.name} uploaded.`);
      router.refresh();
    } catch (uploadError) {
      // The row is only dropped server-side when the URL could not be minted.
      // A failure during the transfer leaves a row with no object behind it,
      // which is what the Failed badge and the delete button are for.
      setError(uploadError.message);
      toast.error("Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function handlePlay(asset) {
    setBusyId(asset.id);
    const { url, error: signError } = await signSourceAssetUrl(supabase, asset.storage_path);
    setBusyId(null);

    if (signError || !url) {
      toast.error("Could not open that file.");
      return;
    }

    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function handleDelete(asset) {
    setBusyId(asset.id);

    // Object first. If the row goes first and this fails, the object is
    // orphaned in a private bucket with nothing left pointing at it.
    const { error: removeError } = await removeSourceAsset(supabase, asset.storage_path);

    if (removeError) {
      setBusyId(null);
      toast.error("Could not delete that file.");
      return;
    }

    const { error: deleteError } = await supabase
      .from("source_assets")
      .delete()
      .eq("id", asset.id);

    setBusyId(null);

    if (deleteError) {
      toast.error("File deleted, but the record could not be removed.");
      return;
    }

    toast.success("Deleted.");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      {canManage ? (
        <Field>
          <FieldLabel htmlFor="source-asset">Upload a recording</FieldLabel>
          <Input
            id="source-asset"
            type="file"
            accept="video/*,audio/*"
            onChange={handleUpload}
            disabled={uploading}
          />
          <FieldDescription>
            Video or audio, up to 5 GB. The file uploads straight to storage — leave this tab
            open until it finishes.
          </FieldDescription>
          {uploading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner />
              Uploading…
              <Progress className="ml-2 w-32" />
            </div>
          ) : null}
        </Field>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {assets.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FilmIcon />
            </EmptyMedia>
            <EmptyTitle>Nothing uploaded yet</EmptyTitle>
            <EmptyDescription>
              Upload a podcast episode, stream VOD or interview and the highlights get found for
              you.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {assets.map((asset) => (
            <li
              key={asset.id}
              className="flex items-center justify-between gap-4 rounded-lg border p-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{asset.filename}</p>
                <p className="text-xs text-muted-foreground">
                  {[
                    STATUS_LABELS[asset.status] ?? asset.status,
                    humanDuration(asset.duration_seconds),
                    humanSize(asset.size_bytes),
                    formatDate(asset.created_at),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {asset.status === "failed" ? (
                  <Badge variant="destructive">Failed</Badge>
                ) : asset.status !== "ready" ? (
                  <Badge variant="secondary">{STATUS_LABELS[asset.status] ?? asset.status}</Badge>
                ) : null}

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePlay(asset)}
                  disabled={busyId === asset.id}
                >
                  Open
                </Button>

                {canManage ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${asset.filename}`}
                    onClick={() => handleDelete(asset)}
                    disabled={busyId === asset.id}
                  >
                    <XIcon />
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
