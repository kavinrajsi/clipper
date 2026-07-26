"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { StarIcon } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"

const SUB_SCORES = [
  ["communication_rating", "Communication"],
  ["quality_rating", "Quality"],
  ["timeliness_rating", "Timeliness"],
]

// A row of five radio buttons that happen to look like stars. Radios rather
// than buttons so arrow keys work and the group is announced as one control.
function RatingInput({ name, label, value, onChange, required = false }) {
  return (
    <fieldset>
      <legend className="text-sm font-medium">
        {label}
        {!required && <span className="text-muted-foreground"> (optional)</span>}
      </legend>
      <div className="mt-2 flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <label
            key={star}
            className="cursor-pointer rounded-sm p-0.5 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring"
          >
            <input
              type="radio"
              name={name}
              value={star}
              checked={value === star}
              onChange={() => onChange(star)}
              required={required && star === 1}
              className="sr-only"
            />
            <StarIcon
              className={cn(
                "size-6 transition-colors",
                value >= star
                  ? "fill-[oklch(0.63_0.24_25)] text-[oklch(0.63_0.24_25)]"
                  : "text-muted-foreground/40 hover:text-muted-foreground",
              )}
            />
            <span className="sr-only">
              {star} star{star === 1 ? "" : "s"}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

// Writes straight through the RLS-scoped client, like save-button and
// submission-form. The released-payout gate is the insert policy, so there is
// nothing an API route could enforce that the database does not already.
export function ReviewForm({ applicationId, direction, subjectId, subjectName, campaignTitle }) {
  const router = useRouter()
  const supabase = createClient()
  const [open, setOpen] = useState(false)
  const [rating, setRating] = useState(0)
  const [subScores, setSubScores] = useState({})
  const [body, setBody] = useState("")
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    if (rating === 0) {
      setError("Pick an overall rating first.")
      return
    }
    setError(null)
    setLoading(true)

    const { error: insertError } = await supabase.from("reviews").insert({
      application_id: applicationId,
      direction,
      subject_id: subjectId,
      rating,
      ...subScores,
      body: body.trim() || null,
    })

    setLoading(false)

    if (insertError) {
      // 42501 is the RLS policy refusing the write, and the only way to hit it
      // from this UI is a payout that is no longer released. 23505 is the
      // one-review-per-side unique constraint.
      if (insertError.code === "42501") {
        setError("This engagement isn't eligible for a review. Its payout may have been reversed.")
      } else if (insertError.code === "23505") {
        setError("You've already reviewed this engagement.")
      } else {
        setError(insertError.message)
      }
      return
    }

    setOpen(false)
    router.refresh()
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button variant="outline" size="sm" nativeButton={false} />}>
        Write a review
      </SheetTrigger>
      <SheetContent className="flex flex-col gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Rate {subjectName}</SheetTitle>
          <SheetDescription>
            {campaignTitle}. Neither of you sees the other&apos;s review until you
            have both submitted, or 14 days pass.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="flex flex-1 flex-col gap-6 px-4 py-2">
          <RatingInput
            name="rating"
            label="Overall"
            value={rating}
            onChange={setRating}
            required
          />

          {SUB_SCORES.map(([key, label]) => (
            <RatingInput
              key={key}
              name={key}
              label={label}
              value={subScores[key] ?? 0}
              onChange={(v) => setSubScores((prev) => ({ ...prev, [key]: v }))}
            />
          ))}

          <Field>
            <FieldLabel htmlFor="review-body">What should others know?</FieldLabel>
            <Textarea
              id="review-body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={5}
              maxLength={2000}
              placeholder="What was the brief, how did it go, would you work together again?"
            />
          </Field>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <p className="text-sm text-muted-foreground">
            You can correct this for an hour. Once it publishes it&apos;s final.
          </p>

          <SheetFooter className="mt-auto px-0">
            <Button type="submit" disabled={loading}>
              {loading && <Spinner />}
              Submit review
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
