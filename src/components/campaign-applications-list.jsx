"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"

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
    return <p className="text-sm text-muted-foreground">No applications yet.</p>;
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
              {application.message && (
                <p className="text-muted-foreground">{application.message}</p>
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
                {new Intl.NumberFormat("en-IN", {
                  style: "currency",
                  currency: "INR",
                }).format(application.payout.amount)}
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
