"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "@/components/ui/field"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { toast } from "sonner"

const CATEGORIES = [
  "Gaming",
  "Comedy",
  "Sports",
  "Music",
  "Tech",
  "IRL",
  "Educational",
]

const STYLE_TAGS = [
  "Fast-cuts",
  "Meme",
  "Storytelling",
  "Highlight-reel",
  "Reaction",
]

const PRICING_MODELS = [
  { label: "Per clip", value: "per_clip" },
  { label: "CPM", value: "cpm" },
  { label: "Flat campaign fee", value: "flat_campaign" },
]

const AVAILABILITY_OPTIONS = [
  { label: "Available", value: "available" },
  { label: "Busy", value: "busy" },
  { label: "Unavailable", value: "unavailable" },
]

export function ClipperProfileForm({ userId, clipperProfile, className, ...props }) {
  const supabase = createClient()
  const [handle, setHandle] = useState(clipperProfile?.handle ?? "")
  const [headline, setHeadline] = useState(clipperProfile?.headline ?? "")
  const [location, setLocation] = useState(clipperProfile?.location ?? "")
  const [languages, setLanguages] = useState((clipperProfile?.languages ?? []).join(", "))
  const [isPublic, setIsPublic] = useState(clipperProfile?.is_public ?? false)
  const [bio, setBio] = useState(clipperProfile?.bio ?? "")
  const [categories, setCategories] = useState(clipperProfile?.categories ?? [])
  const [styleTags, setStyleTags] = useState(clipperProfile?.style_tags ?? [])
  const [pricingModel, setPricingModel] = useState(clipperProfile?.pricing_model ?? "")
  const [rateAmount, setRateAmount] = useState(clipperProfile?.rate_amount ?? "")
  const [availabilityStatus, setAvailabilityStatus] = useState(
    clipperProfile?.availability_status ?? "available"
  )
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  const normalisedHandle = handle.trim().toLowerCase()

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)

    // Publishing without a handle violates a database check constraint, so
    // catch it here with a message that says what to do about it.
    if (isPublic && !normalisedHandle) {
      setError("Pick a handle before making your profile public.")
      return
    }

    setLoading(true)

    const { error: upsertError } = await supabase.from("clipper_profiles").upsert({
      user_id: userId,
      handle: normalisedHandle || null,
      headline: headline || null,
      location: location || null,
      languages: languages
        .split(",")
        .map((l) => l.trim())
        .filter(Boolean),
      is_public: isPublic,
      published_at: isPublic ? (clipperProfile?.published_at ?? new Date().toISOString()) : null,
      bio,
      categories,
      style_tags: styleTags,
      pricing_model: pricingModel || null,
      rate_amount: rateAmount === "" ? null : Number(rateAmount),
      availability_status: availabilityStatus,
      updated_at: new Date().toISOString(),
    })

    if (upsertError) {
      // The unique index, format check and reserved-handle trigger all surface
      // as raw Postgres errors. Translate the ones a user can act on.
      const message = upsertError.message ?? ""
      if (message.includes("clipper_profiles_handle_key")) {
        setError("That handle is taken. Try another.")
      } else if (message.includes("clipper_profiles_handle_format")) {
        setError(
          "Handles are 3–30 characters: lowercase letters, numbers, hyphens and underscores, starting with a letter or number."
        )
      } else if (message.includes("is reserved")) {
        setError(`"${normalisedHandle}" is reserved. Try another.`)
      } else {
        setError(message)
      }
      setLoading(false)
      return
    }

    setLoading(false)
    toast.success(isPublic ? "Profile saved and published." : "Clipper profile saved.")
  }

  return (
    <form onSubmit={handleSubmit} className={cn(className)} {...props}>
      <FieldGroup>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <FieldSet>
          <FieldLegend>Public profile</FieldLegend>
          <Field>
            <FieldLabel htmlFor="handle">Handle</FieldLabel>
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-sm text-muted-foreground">/c/</span>
              <Input
                id="handle"
                value={handle}
                onChange={(event) => setHandle(event.target.value)}
                placeholder="jordan-reyes"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
            <FieldDescription>
              {normalisedHandle
                ? `Your profile will live at /c/${normalisedHandle}`
                : "Lowercase letters, numbers, hyphens and underscores. 3–30 characters."}
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="headline">Headline</FieldLabel>
            <Input
              id="headline"
              value={headline}
              onChange={(event) => setHeadline(event.target.value)}
              placeholder="Podcast clips that actually get watched"
              maxLength={120}
            />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="location">Location</FieldLabel>
              <Input
                id="location"
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                placeholder="Bengaluru, India"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="languages">Languages</FieldLabel>
              <Input
                id="languages"
                value={languages}
                onChange={(event) => setLanguages(event.target.value)}
                placeholder="English, Hindi"
              />
              <FieldDescription>Comma separated.</FieldDescription>
            </Field>
          </div>
          <Field orientation="horizontal">
            <Switch id="is-public" checked={isPublic} onCheckedChange={setIsPublic} />
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor="is-public">Make my profile public</FieldLabel>
              <FieldDescription>
                Anyone can view it, and brands can find you in search. Turn this off to hide it
                again at any time.
              </FieldDescription>
            </div>
          </Field>
        </FieldSet>

        <FieldSeparator />

        <FieldSet>
          <FieldLegend>About you</FieldLegend>
          <Field>
            <FieldLabel htmlFor="bio">Bio</FieldLabel>
            <Textarea
              id="bio"
              placeholder="Tell brands about your content and audience"
              value={bio}
              onChange={(event) => setBio(event.target.value)}
              rows={6}
              className="resize-none"
            />
          </Field>
        </FieldSet>

        <FieldSeparator />

        <FieldSet>
          <FieldLegend>Content</FieldLegend>
          <Field>
            <FieldLabel>Categories</FieldLabel>
            <ToggleGroup
              multiple
              value={categories}
              onValueChange={setCategories}
              variant="outline"
              className="flex-wrap justify-start"
            >
              {CATEGORIES.map((category) => (
                <ToggleGroupItem key={category} value={category}>
                  {category}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>
          <Field>
            <FieldLabel>Content style</FieldLabel>
            <ToggleGroup
              multiple
              value={styleTags}
              onValueChange={setStyleTags}
              variant="outline"
              className="flex-wrap justify-start"
            >
              {STYLE_TAGS.map((tag) => (
                <ToggleGroupItem key={tag} value={tag}>
                  {tag}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>
        </FieldSet>

        <FieldSeparator />

        <FieldSet>
          <FieldLegend>Rates &amp; availability</FieldLegend>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="pricing-model">Pricing model</FieldLabel>
              <Select
                value={pricingModel}
                onValueChange={setPricingModel}
                items={PRICING_MODELS}
              >
                <SelectTrigger id="pricing-model" className="w-full">
                  <SelectValue placeholder="Select a pricing model" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {PRICING_MODELS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="rate-amount">Rate (INR)</FieldLabel>
              <Input
                id="rate-amount"
                type="number"
                min="0"
                step="0.01"
                value={rateAmount}
                onChange={(event) => setRateAmount(event.target.value)}
              />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="availability-status">Availability</FieldLabel>
            <Select
              value={availabilityStatus}
              onValueChange={setAvailabilityStatus}
              items={AVAILABILITY_OPTIONS}
            >
              <SelectTrigger id="availability-status" className="w-full">
                <SelectValue placeholder="Select availability" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {AVAILABILITY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        </FieldSet>
      </FieldGroup>

      <div className="mt-6 flex justify-end border-t pt-6">
        <Button type="submit" disabled={loading}>
          {loading && <Spinner />}
          Save changes
        </Button>
      </div>
    </form>
  );
}
