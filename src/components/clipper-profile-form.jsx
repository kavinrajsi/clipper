"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "@/components/ui/field"
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
  const [bio, setBio] = useState(clipperProfile?.bio ?? "")
  const [categories, setCategories] = useState(clipperProfile?.categories ?? [])
  const [styleTags, setStyleTags] = useState(clipperProfile?.style_tags ?? [])
  const [pricingModel, setPricingModel] = useState(clipperProfile?.pricing_model ?? "")
  const [rateAmount, setRateAmount] = useState(clipperProfile?.rate_amount ?? "")
  const [availabilityStatus, setAvailabilityStatus] = useState(
    clipperProfile?.availability_status ?? "available"
  )
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)
    setSuccess(false)
    setLoading(true)

    const { error: upsertError } = await supabase.from("clipper_profiles").upsert({
      user_id: userId,
      bio,
      categories,
      style_tags: styleTags,
      pricing_model: pricingModel || null,
      rate_amount: rateAmount === "" ? null : Number(rateAmount),
      availability_status: availabilityStatus,
      updated_at: new Date().toISOString(),
    })

    if (upsertError) {
      setError(upsertError.message)
      setLoading(false)
      return
    }

    setLoading(false)
    setSuccess(true)
  }

  return (
    <form onSubmit={handleSubmit} className={cn(className)} {...props}>
      <FieldGroup>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {success && (
          <Alert>
            <AlertDescription>Clipper profile saved.</AlertDescription>
          </Alert>
        )}

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
