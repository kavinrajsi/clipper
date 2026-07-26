"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckIcon, MessageSquarePlusIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

// mm:ss — annotations are about finding a moment, not a duration.
function timecode(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

// Loads the YouTube IFrame API once per page.
//
// This is the reason annotations are timestamps and not regions: the player is
// a cross-origin iframe, so we can ask it to seek and report its position, but
// we cannot draw on top of it. Frame-accurate region markup would need direct
// video upload, which is Phase 3.
function useYouTubePlayer(videoId, containerId) {
  const playerRef = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!videoId) return undefined;
    let cancelled = false;

    function create() {
      if (cancelled || !window.YT?.Player) return;
      playerRef.current = new window.YT.Player(containerId, {
        videoId,
        playerVars: { modestbranding: 1, rel: 0 },
        events: { onReady: () => !cancelled && setReady(true) },
      });
    }

    if (window.YT?.Player) {
      create();
    } else {
      // The API calls a single global hook, so chain rather than clobber it.
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        previous?.();
        create();
      };
      if (!document.getElementById("youtube-iframe-api")) {
        const script = document.createElement("script");
        script.id = "youtube-iframe-api";
        script.src = "https://www.youtube.com/iframe_api";
        document.body.appendChild(script);
      }
    }

    return () => {
      cancelled = true;
      playerRef.current?.destroy?.();
      playerRef.current = null;
    };
  }, [videoId, containerId]);

  return {
    ready,
    currentTime: () => playerRef.current?.getCurrentTime?.() ?? 0,
    seekTo: (seconds) => playerRef.current?.seekTo?.(seconds, true),
    duration: () => playerRef.current?.getDuration?.() ?? 0,
  };
}

// videoId is resolved on the server and passed in. Importing @/lib/youtube
// here would bundle its OAuth helpers into the browser — the secrets are not
// inlined (Next only inlines NEXT_PUBLIC_*), but shipping dead server code to
// the client is not a habit worth starting.
export function SubmissionReview({ submission, videoId, annotations: initial, viewerId, people }) {
  const supabase = createClient();
  const router = useRouter();
  const containerId = `yt-${submission.id}`;
  const player = useYouTubePlayer(videoId, containerId);

  const [annotations, setAnnotations] = useState(initial);
  const [draft, setDraft] = useState(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const roots = annotations.filter((a) => !a.parent_id);
  const repliesOf = (id) => annotations.filter((a) => a.parent_id === id);
  const duration = player.ready ? player.duration() : 0;

  function startNote() {
    setError(null);
    setDraft(player.ready ? player.currentTime() : 0);
    setBody("");
  }

  async function save(parentId = null, at = null) {
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    setError(null);

    const { data, error: writeError } = await supabase
      .from("annotations")
      .insert({
        submission_id: submission.id,
        author_id: viewerId,
        start_seconds: at ?? draft ?? 0,
        body: text,
        parent_id: parentId,
      })
      .select()
      .single();

    setBusy(false);
    if (writeError) {
      setError(writeError.message);
      return;
    }

    setAnnotations((current) => [...current, data]);
    setDraft(null);
    setBody("");
    toast.success("Feedback added.");
    router.refresh();
  }

  async function toggleResolved(annotation) {
    setBusy(true);
    const resolving = !annotation.resolved_at;

    const { error: writeError } = await supabase
      .from("annotations")
      .update({
        resolved_at: resolving ? new Date().toISOString() : null,
        resolved_by: resolving ? viewerId : null,
      })
      .eq("id", annotation.id);

    setBusy(false);
    if (writeError) {
      setError(writeError.message);
      return;
    }
    setAnnotations((current) =>
      current.map((a) =>
        a.id === annotation.id
          ? { ...a, resolved_at: resolving ? new Date().toISOString() : null }
          : a
      )
    );
    router.refresh();
  }

  const unresolved = roots.filter((a) => !a.resolved_at).length;

  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <div className="flex flex-col gap-3">
        {videoId ? (
          <div className="aspect-video w-full overflow-hidden rounded-lg bg-muted">
            <div id={containerId} className="size-full" />
          </div>
        ) : (
          <Alert>
            <AlertDescription>
              This submission isn&apos;t a recognisable YouTube link, so it can&apos;t be played
              here.{" "}
              <a href={submission.video_url} target="_blank" rel="noopener noreferrer" className="underline">
                Open it directly
              </a>
              .
            </AlertDescription>
          </Alert>
        )}

        {/* Marker track: every note as a tick on the timeline. */}
        {videoId && duration > 0 && (
          <div className="relative h-6 rounded-full bg-muted">
            {roots.map((annotation) => (
              <button
                key={annotation.id}
                type="button"
                onClick={() => player.seekTo(annotation.start_seconds)}
                title={`${timecode(annotation.start_seconds)} — ${annotation.body}`}
                aria-label={`Jump to ${timecode(annotation.start_seconds)}`}
                className={cn(
                  "absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background",
                  annotation.resolved_at ? "bg-muted-foreground" : "bg-primary"
                )}
                style={{
                  left: `${Math.min(100, (annotation.start_seconds / duration) * 100)}%`,
                }}
              />
            ))}
          </div>
        )}

        <Button onClick={startNote} disabled={!player.ready} size="sm" variant="outline">
          <MessageSquarePlusIcon />
          {player.ready ? "Comment at current time" : "Loading player…"}
        </Button>

        {draft !== null && (
          <div className="flex flex-col gap-2 rounded-lg border p-3">
            <Badge variant="secondary" className="w-fit tabular-nums">
              {timecode(draft)}
            </Badge>
            <Textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={3}
              autoFocus
              placeholder="What should change at this moment?"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={() => save()} disabled={busy || !body.trim()}>
                {busy && <Spinner />}
                Add note
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <p className="text-sm text-muted-foreground">
          {roots.length === 0
            ? "No feedback yet."
            : `${unresolved} of ${roots.length} unresolved`}
        </p>

        <ul className="flex flex-col gap-2">
          {roots
            .slice()
            .sort((a, b) => a.start_seconds - b.start_seconds)
            .map((annotation) => (
              <li
                key={annotation.id}
                className={cn(
                  "rounded-lg border p-3",
                  annotation.resolved_at && "opacity-60"
                )}
              >
                <div className="flex items-start gap-2">
                  <button
                    type="button"
                    onClick={() => player.seekTo(annotation.start_seconds)}
                    className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs tabular-nums hover:bg-muted-foreground/20"
                  >
                    {timecode(annotation.start_seconds)}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">{annotation.body}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {people[annotation.author_id]?.full_name ?? "Someone"}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={busy}
                    aria-label={annotation.resolved_at ? "Mark unresolved" : "Mark resolved"}
                    onClick={() => toggleResolved(annotation)}
                  >
                    <CheckIcon className={annotation.resolved_at ? "text-primary" : undefined} />
                  </Button>
                </div>

                {repliesOf(annotation.id).map((reply) => (
                  <div key={reply.id} className="mt-2 flex gap-2 border-l pl-3">
                    <Avatar className="size-5">
                      <AvatarFallback className="text-[9px]">
                        {(people[reply.author_id]?.full_name ?? "?").slice(0, 1).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <p className="text-sm text-muted-foreground">{reply.body}</p>
                  </div>
                ))}
              </li>
            ))}
        </ul>
      </div>
    </div>
  );
}
