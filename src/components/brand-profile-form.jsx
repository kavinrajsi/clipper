"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"

export function BrandProfileForm({ userId, brandProfile, className, ...props }) {
  const supabase = createClient()
  const [companyName, setCompanyName] = useState(brandProfile?.company_name ?? "")
  const [website, setWebsite] = useState(brandProfile?.website ?? "")
  const [industry, setIndustry] = useState(brandProfile?.industry ?? "")
  const [description, setDescription] = useState(brandProfile?.description ?? "")
  const [logoUrl, setLogoUrl] = useState(brandProfile?.logo_url ?? null)
  const [logoPreview, setLogoPreview] = useState(null)
  const [selectedFile, setSelectedFile] = useState(null)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)
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
    setSuccess(false)
    setLoading(true)

    let nextLogoUrl = logoUrl

    if (selectedFile) {
      const ext = selectedFile.name.split(".").pop()
      const path = `${userId}/logo.${ext}`

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, selectedFile, { upsert: true })

      if (uploadError) {
        setError(uploadError.message)
        setLoading(false)
        return
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from("avatars").getPublicUrl(path)
      nextLogoUrl = `${publicUrl}?updated=${Date.now()}`
    }

    const { error: upsertError } = await supabase.from("brand_profiles").upsert({
      user_id: userId,
      company_name: companyName,
      website: website || null,
      industry: industry || null,
      description: description || null,
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
    setSuccess(true)
  }

  return (
    <Card className={cn(className)} {...props}>
      <CardHeader>
        <CardTitle>Brand Profile</CardTitle>
        <CardDescription>What clippers see when evaluating your campaigns</CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent>
          <FieldGroup>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {success && (
              <Alert>
                <AlertDescription>Brand profile saved.</AlertDescription>
              </Alert>
            )}
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
            <div className="grid grid-cols-2 gap-4">
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
                rows={4}
              />
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter>
          <Button type="submit" disabled={loading}>
            {loading && <Spinner />}
            Save changes
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
