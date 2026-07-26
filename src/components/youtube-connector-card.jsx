"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { CheckCircle2Icon } from "lucide-react"
import { formatDateTime } from "@/lib/format"

function YoutubeIcon(props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" {...props}>
      <path
        d="M23.5 6.2a3 3 0 0 0-2.11-2.13C19.51 3.5 12 3.5 12 3.5s-7.51 0-9.39.57A3 3 0 0 0 .5 6.2 31.6 31.6 0 0 0 0 12a31.6 31.6 0 0 0 .5 5.8 3 3 0 0 0 2.11 2.13C4.49 20.5 12 20.5 12 20.5s7.51 0 9.39-.57a3 3 0 0 0 2.11-2.13A31.6 31.6 0 0 0 24 12a31.6 31.6 0 0 0-.5-5.8Z"
        fill="#FF0000" />
      <path d="M9.6 15.6 15.8 12 9.6 8.4Z" fill="#FFFFFF" />
    </svg>
  );
}


export function YoutubeConnectorCard({ connection }) {
  const router = useRouter()
  const [syncing, setSyncing] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [choosingMethod, setChoosingMethod] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [verifyMessage, setVerifyMessage] = useState(null)
  const [error, setError] = useState(null)

  const isConnected = Boolean(connection)
  const hasChosenMethod = Boolean(connection?.verification_method)
  const isVerified =
    connection?.verification_method === "linked" ||
    (connection?.verification_method === "bio_code" && Boolean(connection?.verified_at))
  const pendingBioVerification =
    connection?.verification_method === "bio_code" && !connection?.verified_at

  async function handleChooseMethod(method) {
    setError(null)
    setChoosingMethod(true)
    const response = await fetch("/api/connectors/youtube/choose-method", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method }),
    })
    setChoosingMethod(false)

    if (!response.ok) {
      setError("Couldn't save your choice. Try again.")
      return
    }

    router.refresh()
  }

  async function handleVerifyBio() {
    setError(null)
    setVerifyMessage(null)
    setVerifying(true)
    const response = await fetch("/api/connectors/youtube/verify-bio", { method: "POST" })
    const result = await response.json().catch(() => null)
    setVerifying(false)

    if (!response.ok) {
      setError("Verification failed. Try again.")
      return
    }

    if (!result?.verified) {
      setVerifyMessage("Code not found yet — make sure you saved it to your channel description.")
      return
    }

    router.refresh()
  }

  async function handleSync() {
    setError(null)
    setSyncing(true)
    const response = await fetch("/api/connectors/youtube/sync", { method: "POST" })
    setSyncing(false)

    if (!response.ok) {
      setError("Sync failed. Try again.")
      return
    }

    router.refresh()
  }

  async function handleDisconnect() {
    setError(null)
    setDisconnecting(true)
    const response = await fetch("/api/connectors/youtube/disconnect", { method: "POST" })
    setDisconnecting(false)

    if (!response.ok) {
      setError("Disconnect failed. Try again.")
      return
    }

    router.refresh()
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <YoutubeIcon className="size-8" />
          <div>
            <CardTitle>YouTube</CardTitle>
            <CardDescription>Channel, videos, and analytics</CardDescription>
          </div>
        </div>
        {isVerified && (
          <CardAction>
            <CheckCircle2Icon className="size-5 text-green-500" />
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && <p className="text-sm text-destructive">{error}</p>}

        {!isConnected && (
          <p className="text-sm text-muted-foreground">
            Connect a Google account to pull channel, video, and analytics data.
          </p>
        )}

        {isConnected && !hasChosenMethod && connection?.bio_code_confirmed_at && (
          <div className="flex flex-col gap-3">
            <div className="rounded-lg border bg-muted/50 p-3">
              <p className="text-sm font-medium">Channel ownership confirmed</p>
              <p className="text-sm text-muted-foreground">
                Connect with OAuth now to activate full earnings.
              </p>
            </div>
            <Button
              size="sm"
              onClick={() => handleChooseMethod("linked")}
              disabled={choosingMethod}
            >
              {choosingMethod && <Spinner />}
              Connect with OAuth
            </Button>
          </div>
        )}

        {isConnected && !hasChosenMethod && !connection?.bio_code_confirmed_at && (
          <div className="flex flex-col gap-3">
            <div className="rounded-lg border p-3">
              <p className="text-sm font-medium">Link your account</p>
              <p className="text-sm text-muted-foreground">
                Directly link your social account to receive the full campaign rate.
              </p>
              <Button
                className="mt-2"
                size="sm"
                onClick={() => handleChooseMethod("linked")}
                disabled={choosingMethod}
              >
                {choosingMethod && <Spinner />}
                Link account — Full earnings
              </Button>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-sm font-medium">Add a code to your bio</p>
              <p className="text-sm text-muted-foreground">
                Paste a code in your bio to verify ownership. Earn 75% of the campaign's
                payout rate.
              </p>
              <Button
                className="mt-2"
                size="sm"
                variant="outline"
                onClick={() => handleChooseMethod("bio_code")}
                disabled={choosingMethod}
              >
                {choosingMethod && <Spinner />}
                Use bio code — 25% less
              </Button>
            </div>
          </div>
        )}

        {pendingBioVerification && (
          <div className="flex flex-col gap-3">
            <div className="rounded-lg border bg-muted/50 p-3">
              <p className="text-sm text-muted-foreground">
                Paste this code anywhere in your YouTube channel description, save it, then
                verify below.
              </p>
              <p className="mt-2 font-mono text-lg font-semibold">
                {connection.verification_code}
              </p>
            </div>
            {verifyMessage && <p className="text-sm text-muted-foreground">{verifyMessage}</p>}
            <Button size="sm" onClick={handleVerifyBio} disabled={verifying}>
              {verifying && <Spinner />}
              I've added it — Verify
            </Button>
          </div>
        )}

        {isVerified && (
          <div className="flex items-center gap-3">
            <Avatar>
              <AvatarImage
                src={connection.channel_thumbnail_url}
                alt={connection.channel_title}
              />
              <AvatarFallback>
                {connection.channel_title?.[0]?.toUpperCase() ?? "Y"}
              </AvatarFallback>
            </Avatar>
            <div className="text-sm">
              <p className="font-medium">{connection.channel_title}</p>
              <p className="text-muted-foreground">
                Last synced: {formatDateTime(connection.last_synced_at, { fallback: "Never" })}
              </p>
            </div>
            <Badge variant="outline" className="ml-auto">
              {connection.verification_method === "linked" ? "Full earnings" : "75% rate"}
            </Badge>
          </div>
        )}
      </CardContent>
      <CardFooter className="gap-2">
        {!isConnected && (
          <Button nativeButton={false} render={<a href="/api/connectors/youtube/start" />}>
            Connect with Google
          </Button>
        )}
        {isVerified && (
          <>
            <Button onClick={handleSync} disabled={syncing}>
              {syncing && <Spinner />}
              Sync now
            </Button>
            <Button variant="outline" onClick={handleDisconnect} disabled={disconnecting}>
              {disconnecting && <Spinner />}
              Disconnect
            </Button>
          </>
        )}
      </CardFooter>
    </Card>
  );
}
