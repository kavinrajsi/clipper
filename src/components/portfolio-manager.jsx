"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, VideoIcon, XIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";

// Keeps profiles tight, and keeps the picker from becoming a bulk-import tool.
const MAX_ITEMS = 12;

function watchUrl(videoId) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function PortfolioManager({ userId, items, syncedVideos, className }) {
  const supabase = createClient();
  const router = useRouter();
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const atCapacity = items.length >= MAX_ITEMS;
  const addedVideoIds = new Set(items.map((item) => item.youtube_video_id).filter(Boolean));
  const candidates = syncedVideos.filter((video) => !addedVideoIds.has(video.video_id));

  async function addVideo(video) {
    setError(null);
    setBusyId(video.video_id);

    const { error: insertError } = await supabase.from("portfolio_items").insert({
      user_id: userId,
      source: "youtube_video",
      youtube_video_id: video.video_id,
      title: video.title,
      thumbnail_url: video.thumbnail_url,
      video_url: watchUrl(video.video_id),
      view_count: video.view_count,
      position: items.length,
    });

    setBusyId(null);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setPickerOpen(false);
    toast.success("Added to your portfolio.");
    router.refresh();
  }

  async function removeItem(item) {
    setError(null);
    setBusyId(item.id);

    const { error: deleteError } = await supabase
      .from("portfolio_items")
      .delete()
      .eq("id", item.id);

    setBusyId(null);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    toast.success("Removed from your portfolio.");
    router.refresh();
  }

  // Swaps two adjacent positions. Two writes rather than renumbering the whole
  // list — only the pair actually changes.
  async function move(index, direction) {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;

    const a = items[index];
    const b = items[target];
    setError(null);
    setBusyId(a.id);

    const [{ error: e1 }, { error: e2 }] = await Promise.all([
      supabase.from("portfolio_items").update({ position: b.position }).eq("id", a.id),
      supabase.from("portfolio_items").update({ position: a.position }).eq("id", b.id),
    ]);

    setBusyId(null);
    if (e1 || e2) {
      setError((e1 ?? e2).message);
      return;
    }
    router.refresh();
  }

  return (
    <Card className={cn(className)}>
      <CardHeader>
        <CardTitle>Work</CardTitle>
        <CardDescription>
          Clips brands see on your public profile. Shown in this order — put your strongest first.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {items.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <VideoIcon />
              </EmptyMedia>
              <EmptyTitle>No clips yet</EmptyTitle>
              <EmptyDescription>
                {syncedVideos.length > 0
                  ? "Add clips from the channel you've connected."
                  : "Connect your YouTube channel in Connectors, sync it, then add clips here."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map((item, index) => (
              <li key={item.id} className="flex items-center gap-3">
                {item.thumbnail_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.thumbnail_url}
                    alt=""
                    className="aspect-video w-28 shrink-0 rounded object-cover"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm font-medium">{item.title ?? "Untitled clip"}</p>
                  {item.view_count != null && (
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {formatNumber(item.view_count)} views
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Move up"
                    disabled={index === 0 || busyId === item.id}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUpIcon />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Move down"
                    disabled={index === items.length - 1 || busyId === item.id}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDownIcon />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Remove"
                    disabled={busyId === item.id}
                    onClick={() => removeItem(item)}
                  >
                    {busyId === item.id ? <Spinner /> : <XIcon />}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {items.length} of {MAX_ITEMS}
          </p>

          <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
            <DialogTrigger
              render={
                <Button variant="outline" size="sm" disabled={atCapacity || candidates.length === 0} />
              }
            >
              <PlusIcon />
              Add clips
            </DialogTrigger>
            <DialogContent className="max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Add from your channel</DialogTitle>
                <DialogDescription>
                  Synced from YouTube. Clips already in your portfolio aren&apos;t listed.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-2">
                {candidates.map((video) => (
                  <button
                    key={video.video_id}
                    type="button"
                    onClick={() => addVideo(video)}
                    disabled={busyId === video.video_id}
                    className="flex items-center gap-3 rounded-md p-2 text-left hover:bg-muted disabled:opacity-60"
                  >
                    {video.thumbnail_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={video.thumbnail_url}
                        alt=""
                        className="aspect-video w-24 shrink-0 rounded object-cover"
                      />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 block text-sm font-medium">{video.title}</span>
                      {video.view_count != null && (
                        <span className="block text-xs text-muted-foreground tabular-nums">
                          {formatNumber(video.view_count)} views
                        </span>
                      )}
                    </span>
                    {busyId === video.video_id && <Spinner />}
                  </button>
                ))}
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {atCapacity && (
          <p className="text-xs text-muted-foreground">
            You&apos;ve reached the maximum. Remove a clip to add another.
          </p>
        )}
        {!atCapacity && candidates.length === 0 && syncedVideos.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Every synced clip is already in your portfolio. Sync again in Connectors to pull new
            uploads.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
