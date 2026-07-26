"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DownloadIcon, PaperclipIcon, XIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { removeBrandAsset, signBrandAssetUrl, uploadBrandAsset } from "@/lib/storage";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";

const KINDS = [
  { value: "logo", label: "Logo" },
  { value: "font", label: "Font" },
  { value: "music", label: "Music" },
  { value: "sting", label: "Intro / outro" },
  { value: "b_roll", label: "B-roll" },
  { value: "template", label: "Template" },
  { value: "document", label: "Document" },
  { value: "other", label: "Other" },
];

// 50MB. Large enough for a logo pack or a sting, small enough that a browser
// upload stays reliable.
const MAX_BYTES = 50 * 1024 * 1024;

function humanSize(bytes) {
  if (!bytes) return "";
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

export function BrandAssetsManager({ workspaceId, assets, canManage }) {
  const supabase = createClient();
  const router = useRouter();
  const [kind, setKind] = useState("logo");
  const [rights, setRights] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  async function upload(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (file.size > MAX_BYTES) {
      setError(`${file.name} is ${humanSize(file.size)} — the limit is 50 MB.`);
      return;
    }

    setError(null);
    setUploading(true);

    const { path, error: uploadError } = await uploadBrandAsset(supabase, workspaceId, file);
    if (uploadError) {
      setUploading(false);
      setError(uploadError.message);
      return;
    }

    const { error: rowError } = await supabase.from("brand_assets").insert({
      workspace_id: workspaceId,
      kind,
      name: file.name,
      storage_path: path,
      mime_type: file.type || null,
      size_bytes: file.size,
      usage_rights: rights || null,
    });

    setUploading(false);
    if (rowError) {
      setError(rowError.message);
      return;
    }

    setRights("");
    toast.success("Asset added.");
    router.refresh();
  }

  // Private bucket — a fresh short-lived URL per click, rather than a permanent
  // link that would outlive access.
  async function download(asset) {
    setBusyId(asset.id);
    const { url, error: signError } = await signBrandAssetUrl(supabase, asset.storage_path);
    setBusyId(null);

    if (signError || !url) {
      setError(signError?.message ?? "Couldn't create a download link.");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function remove(asset) {
    setBusyId(asset.id);
    setError(null);

    const { error: storageError } = await removeBrandAsset(supabase, asset.storage_path);
    if (storageError) {
      setBusyId(null);
      setError(storageError.message);
      return;
    }

    const { error: rowError } = await supabase.from("brand_assets").delete().eq("id", asset.id);
    setBusyId(null);

    if (rowError) {
      setError(rowError.message);
      return;
    }
    toast.success("Asset removed.");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {assets.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <PaperclipIcon />
            </EmptyMedia>
            <EmptyTitle>No assets yet</EmptyTitle>
            <EmptyDescription>
              Logos, fonts, music and stings live here. Approved creators can download them, so
              they stop guessing at your brand.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {assets.map((asset) => (
            <li key={asset.id} className="flex items-center gap-3 rounded-lg border p-3">
              <PaperclipIcon className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{asset.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {humanSize(asset.size_bytes)}
                  {asset.size_bytes ? " · " : ""}
                  added {formatDate(asset.created_at, { style: "medium" })}
                  {asset.usage_rights ? ` · ${asset.usage_rights}` : ""}
                </p>
              </div>
              <Badge variant="outline">
                {KINDS.find((k) => k.value === asset.kind)?.label ?? asset.kind}
              </Badge>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Download ${asset.name}`}
                disabled={busyId === asset.id}
                onClick={() => download(asset)}
              >
                {busyId === asset.id ? <Spinner /> : <DownloadIcon />}
              </Button>
              {canManage && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${asset.name}`}
                  disabled={busyId === asset.id}
                  onClick={() => remove(asset)}
                >
                  <XIcon />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <div className="flex flex-col gap-3 rounded-lg border p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="asset-kind">Type</FieldLabel>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger id="asset-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KINDS.map((k) => (
                    <SelectItem key={k.value} value={k.value}>
                      {k.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="asset-rights">Usage rights</FieldLabel>
              <Input
                id="asset-rights"
                value={rights}
                onChange={(event) => setRights(event.target.value)}
                placeholder="Licensed for campaign use only"
              />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="asset-file">Add a file</FieldLabel>
            <Input id="asset-file" type="file" onChange={upload} disabled={uploading} />
            <FieldDescription>
              Up to 50 MB. Licensed fonts and music often can&apos;t be redistributed — note the
              terms above so creators know what they may use.
            </FieldDescription>
          </Field>
          {uploading && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner /> Uploading…
            </p>
          )}
        </div>
      )}
    </div>
  );
}
