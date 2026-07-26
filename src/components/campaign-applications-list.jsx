"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import { UsersRoundIcon } from "lucide-react"
import { formatCurrency } from "@/lib/format"

const STATUS_VARIANT = {
  pending: "secondary",
  approved: "default",
  rejected: "destructive",
}

const SUBMISSION_STATUS_VARIANT = {
  submitted: "secondary",
  approved: "default",
  rejected: "destructive",
}

const PAYOUT_STATUS_VARIANT = {
  pending: "secondary",
  held: "secondary",
  released: "default",
  failed: "destructive",
}

function getInitials(name) {
  if (!name) return "?"
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

export function CampaignApplicationsList({ applications }) {
  const router = useRouter()
  const supabase = createClient()
  const [loadingId, setLoadingId] = useState(null)
  const [error, setError] = useState(null)

  async function handleReview(applicationId, status) {
    setLoadingId(applicationId)
    const { error } = await supabase
      .from("campaign_applications")
      .update({ status, reviewed_at: new Date().toISOString() })
      .eq("id", applicationId)
    setLoadingId(null)

    if (!error) {
      router.refresh()
    }
  }

  async function handleRejectSubmission(submissionId) {
    setLoadingId(submissionId)
    const { error } = await supabase
      .from("campaign_submissions")
      .update({ status: "rejected", updated_at: new Date().toISOString() })
      .eq("id", submissionId)
    setLoadingId(null)

    if (!error) {
      router.refresh()
    }
  }

  async function handleApproveSubmission(submissionId) {
    setError(null)
    setLoadingId(submissionId)
    const response = await fetch(`/api/payments/submissions/${submissionId}/approve`, {
      method: "POST",
    })
    const result = await response.json().catch(() => null)
    setLoadingId(null)

    if (!response.ok) {
      setError(result?.error ?? "Couldn't approve submission.")
      return
    }

    router.refresh()
  }

  async function handleReleasePayout(payoutId) {
    setError(null)
    setLoadingId(payoutId)
    const response = await fetch(`/api/payments/payouts/${payoutId}/release`, {
      method: "POST",
    })
    const result = await response.json().catch(() => null)
    setLoadingId(null)

    if (!response.ok) {
      setError(result?.error ?? "Couldn't release payment.")
      return
    }

    router.refresh()
  }

  if (applications.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <UsersRoundIcon />
          </EmptyMedia>
          <EmptyTitle>No applications yet</EmptyTitle>
          <EmptyDescription>
            Invite creators directly from the Invited tab instead of waiting.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-sm text-destructive">{error}</p>}
      {applications.map((application) => (
        <div key={application.id} className="flex flex-col gap-3 rounded-lg border p-3">
          <div className="flex items-center gap-3">
            <Avatar>
              <AvatarImage
                src={application.clipper?.avatar_url}
                alt={application.clipper?.full_name}
              />
              <AvatarFallback>{getInitials(application.clipper?.full_name)}</AvatarFallback>
            </Avatar>
            <div className="flex-1 text-sm">
              <p className="font-medium">{application.clipper?.full_name ?? "Unknown clipper"}</p>
              {/* Comparable terms, so a brand can weigh applicants against each
                  other rather than on cover-letter length alone. Bids are only
                  ever visible here, to the campaign owner. */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
                {application.bid_amount != null ? (
                  <span>
                    Bid <span className="font-medium text-foreground tabular-nums">
                      {formatCurrency(application.bid_amount)}
                    </span>
                  </span>
                ) : (
                  <span>Accepts posted rate</span>
                )}
                {application.estimated_delivery_days != null && (
                  <span>
                    Delivers in{" "}
                    <span className="font-medium text-foreground tabular-nums">
                      {application.estimated_delivery_days}d
                    </span>
                  </span>
                )}
              </div>
              {application.message && (
                <p className="mt-1 text-muted-foreground">{application.message}</p>
              )}
              {application.attachments?.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {application.attachments.map((item) => (
                    <a
                      key={item.id}
                      href={item.video_url ?? "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={item.title ?? "Clip"}
                      className="block w-24 shrink-0"
                    >
                      {item.thumbnail_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.thumbnail_url}
                          alt={item.title ?? "Clip"}
                          className="aspect-video w-full rounded object-cover hover:opacity-90"
                        />
                      )}
                    </a>
                  ))}
                </div>
              )}
            </div>
            {application.status === "pending" ? (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => handleReview(application.id, "approved")}
                  disabled={loadingId === application.id}
                >
                  {loadingId === application.id && <Spinner />}
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleReview(application.id, "rejected")}
                  disabled={loadingId === application.id}
                >
                  Reject
                </Button>
              </div>
            ) : (
              <Badge variant={STATUS_VARIANT[application.status] ?? "outline"}>
                {application.status}
              </Badge>
            )}
          </div>

          {application.submission && (
            <div className="flex items-center gap-3 rounded-md bg-muted/50 p-2 pl-4 text-sm">
              <a
                href={application.submission.video_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 truncate underline underline-offset-4"
              >
                {application.submission.video_url}
              </a>
              {/* Timestamped review beats approving or rejecting on a hunch —
                  it is what collapses a revision round-trip. */}
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<Link href={`/submissions/${application.submission.id}`} />}
              >
                Review
              </Button>
              {application.submission.status === "submitted" ? (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => handleApproveSubmission(application.submission.id)}
                    disabled={loadingId === application.submission.id}
                  >
                    {loadingId === application.submission.id && <Spinner />}
                    Approve clip
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleRejectSubmission(application.submission.id)}
                    disabled={loadingId === application.submission.id}
                  >
                    Reject
                  </Button>
                </div>
              ) : (
                <Badge
                  variant={SUBMISSION_STATUS_VARIANT[application.submission.status] ?? "outline"}
                >
                  {application.submission.status}
                </Badge>
              )}
            </div>
          )}

          {application.payout && (
            <div className="flex items-center gap-3 rounded-md bg-muted/50 p-2 pl-4 text-sm">
              <span className="flex-1">
                Payout:{" "}
                {formatCurrency(application.payout.amount)}
              </span>
              {application.payout.status === "held" ? (
                <Button
                  size="sm"
                  onClick={() => handleReleasePayout(application.payout.id)}
                  disabled={loadingId === application.payout.id}
                >
                  {loadingId === application.payout.id && <Spinner />}
                  Release payment
                </Button>
              ) : (
                <Badge variant={PAYOUT_STATUS_VARIANT[application.payout.status] ?? "outline"}>
                  {application.payout.status}
                </Badge>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
