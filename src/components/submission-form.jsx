"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { extractYoutubeVideoId } from "@/lib/youtube"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"

export function SubmissionForm({ applicationId }) {
  const router = useRouter()
  const supabase = createClient()
  const [open, setOpen] = useState(false)
  const [videoUrl, setVideoUrl] = useState("")
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)
    setLoading(true)

    // A per-view payout is computed from the synced youtube_videos row and
    // nothing else, so a URL that doesn't parse can never be approved. Catch it
    // here rather than after the creator has done the work.
    const videoId = extractYoutubeVideoId(videoUrl)
    if (!videoId) {
      setError("Paste a YouTube video URL — for example https://youtube.com/watch?v=dQw4w9WgXcQ")
      setLoading(false)
      return
    }

    const { data: video } = await supabase
      .from("youtube_videos")
      .select("view_count")
      .eq("video_id", videoId)
      .single()
    const viewCountAtSubmission = video?.view_count ?? null

    const { error: insertError } = await supabase.from("campaign_submissions").insert({
      application_id: applicationId,
      video_url: videoUrl,
      view_count_at_submission: viewCountAtSubmission,
    })

    setLoading(false)

    if (insertError) {
      setError(insertError.message)
      return
    }

    setOpen(false)
    setVideoUrl("")
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>Submit video</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Submit your clip</DialogTitle>
          <DialogDescription>
            Paste the YouTube video URL for the campaign. The brand reviews it before payout.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          {error && (
            <Alert variant="destructive" className="mb-3">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Field>
            <FieldLabel htmlFor="video-url">Video URL</FieldLabel>
            <Input
              id="video-url"
              type="url"
              placeholder="https://youtube.com/watch?v=..."
              value={videoUrl}
              onChange={(event) => setVideoUrl(event.target.value)}
              required
            />
          </Field>
          <DialogFooter className="mt-4">
            <Button type="submit" disabled={loading}>
              {loading && <Spinner />}
              Submit
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
