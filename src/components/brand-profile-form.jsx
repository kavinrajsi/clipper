"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"
import { uploadPublicImage } from "@/lib/storage"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
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
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"

export function BrandProfileForm({ userId, brandProfile, className, ...props }) {
  const supabase = createClient()
  const [companyName, setCompanyName] = useState(brandProfile?.company_name ?? "")
  const [website, setWebsite] = useState(brandProfile?.website ?? "")
  const [industry, setIndustry] = useState(brandProfile?.industry ?? "")
  const [description, setDescription] = useState(brandProfile?.description ?? "")
  const [fontName, setFontName] = useState(brandProfile?.font_name ?? "")
  const [colorCode, setColorCode] = useState(brandProfile?.color_code ?? "")
  const [logoUrl, setLogoUrl] = useState(brandProfile?.logo_url ?? null)
  const [logoPreview, setLogoPreview] = useState(null)
  const [selectedFile, setSelectedFile] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  function handleFileChange(event) {
    const file = event.target.files?.[0]
    if (!file) return
    setSelectedFile(file)
    setLogoPreview(URL.createObjectURL(file))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)
    setLoading(true)

    // brand_profiles_website_scheme rejects anything that isn't http(s), so
    // catch the common "typed it without a scheme" case here — otherwise the
    // user sees the raw constraint name out of Postgres.
    if (website && !/^https?:\/\/[^\s/]/i.test(website)) {
      setError("Website has to start with http:// or https://")
      setLoading(false)
      return
    }

    let nextLogoUrl = logoUrl

    if (selectedFile) {
      const { url, error: uploadError } = await uploadPublicImage(
        supabase,
        userId,
        selectedFile,
        "logo"
      )

      if (uploadError) {
        setError(uploadError.message)
        setLoading(false)
        return
      }

      nextLogoUrl = url
    }

    const { error: upsertError } = await supabase.from("brand_profiles").upsert({
      user_id: userId,
      company_name: companyName,
      website: website || null,
      industry: industry || null,
      description: description || null,
      font_name: fontName || null,
      color_code: colorCode || null,
      logo_url: nextLogoUrl,
      updated_at: new Date().toISOString(),
    })

    if (upsertError) {
      setError(upsertError.message)
      setLoading(false)
      return
    }

    setLogoUrl(nextLogoUrl)
    setSelectedFile(null)
    setLogoPreview(null)
    setLoading(false)
    toast.success("Brand profile saved.")
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
          <FieldLegend>Branding</FieldLegend>
          <Field>
            <div className="flex items-center gap-4">
              <Avatar className="size-16">
                <AvatarImage src={logoPreview ?? logoUrl ?? undefined} alt={companyName} />
                <AvatarFallback>{companyName?.[0]?.toUpperCase() ?? "B"}</AvatarFallback>
              </Avatar>
              <Input
                id="logo"
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="max-w-56"
              />
            </div>
          </Field>
          <Field>
            <FieldLabel htmlFor="company-name">Company name</FieldLabel>
            <Input
              id="company-name"
              value={companyName}
              onChange={(event) => setCompanyName(event.target.value)}
              required
            />
          </Field>
        </FieldSet>

        <FieldSeparator />

        <FieldSet>
          <FieldLegend>Brand style</FieldLegend>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="font-name">Font name</FieldLabel>
              <Input
                id="font-name"
                placeholder="e.g. Inter"
                value={fontName}
                onChange={(event) => setFontName(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="color-code">Color code</FieldLabel>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label="Pick brand color"
                  value={/^#[0-9a-fA-F]{6}$/.test(colorCode) ? colorCode : "#000000"}
                  onChange={(event) => setColorCode(event.target.value)}
                  className="h-9 w-9 shrink-0 cursor-pointer rounded-md border bg-transparent p-1"
                />
                <Input
                  id="color-code"
                  placeholder="#7C3AED"
                  value={colorCode}
                  onChange={(event) => setColorCode(event.target.value)}
                />
              </div>
            </Field>
          </div>
        </FieldSet>

        <FieldSeparator />

        <FieldSet>
          <FieldLegend>About</FieldLegend>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="website">Website</FieldLabel>
              <Input
                id="website"
                type="url"
                placeholder="https://example.com"
                value={website}
                onChange={(event) => setWebsite(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="industry">Industry</FieldLabel>
              <Input
                id="industry"
                value={industry}
                onChange={(event) => setIndustry(event.target.value)}
              />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="description">Description</FieldLabel>
            <Textarea
              id="description"
              placeholder="Tell clippers what your company does"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={6}
            />
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
