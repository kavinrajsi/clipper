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
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { toast } from "sonner"

function getInitials(name, email) {
  if (name) {
    return name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join("");
  }
  return email ? email[0].toUpperCase() : "?";
}

export function ProfileForm({ user, profile, className, ...props }) {
  const supabase = createClient()
  const [fullName, setFullName] = useState(
    profile?.full_name ?? user.user_metadata?.full_name ?? user.user_metadata?.name ?? ""
  )
  const [avatarUrl, setAvatarUrl] = useState(
    profile?.avatar_url ?? user.user_metadata?.avatar_url ?? null
  )
  const [avatarPreview, setAvatarPreview] = useState(null)
  const [selectedFile, setSelectedFile] = useState(null)
  const [role, setRole] = useState(profile?.role ?? "clipper")
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  function handleFileChange(event) {
    const file = event.target.files?.[0]
    if (!file) return
    setSelectedFile(file)
    setAvatarPreview(URL.createObjectURL(file))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)
    setLoading(true)

    let nextAvatarUrl = avatarUrl

    if (selectedFile) {
      const ext = selectedFile.name.split(".").pop()
      const path = `${user.id}/avatar.${ext}`

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
      nextAvatarUrl = `${publicUrl}?updated=${Date.now()}`
    }

    const { error: updateError } = await supabase
      .from("profiles")
      .update({
        full_name: fullName,
        avatar_url: nextAvatarUrl,
        role,
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id)

    if (updateError) {
      setError(updateError.message)
      setLoading(false)
      return
    }

    setAvatarUrl(nextAvatarUrl)
    setSelectedFile(null)
    setAvatarPreview(null)
    setLoading(false)
    toast.success("Profile updated.")
  }

  return (
    <Card className={cn(className)} {...props}>
      <CardHeader>
        <CardTitle>Account</CardTitle>
        <CardDescription>Your name and avatar</CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent>
          <FieldGroup>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Field>
              <div className="flex items-center gap-4">
                <Avatar className="size-16">
                  <AvatarImage
                    src={avatarPreview ?? avatarUrl ?? undefined}
                    alt={fullName || user.email}
                  />
                  <AvatarFallback>{getInitials(fullName, user.email)}</AvatarFallback>
                </Avatar>
                <Input
                  id="avatar"
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  className="max-w-56"
                />
              </div>
            </Field>
            <Field>
              <FieldLabel>I&apos;m a</FieldLabel>
              <ToggleGroup
                value={[role]}
                onValueChange={(value) => setRole(value[0] ?? "clipper")}
                variant="outline"
                className="w-full"
              >
                <ToggleGroupItem value="clipper" className="flex-1">
                  Clipper
                </ToggleGroupItem>
                <ToggleGroupItem value="brand" className="flex-1">
                  Brand
                </ToggleGroupItem>
              </ToggleGroup>
            </Field>
            <Field>
              <FieldLabel htmlFor="full-name">Full Name</FieldLabel>
              <Input
                id="full-name"
                type="text"
                placeholder="John Doe"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input id="email" type="email" value={user.email} disabled />
              <FieldDescription>Email can&apos;t be changed here.</FieldDescription>
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
