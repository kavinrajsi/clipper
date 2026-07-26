"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { CampaignForm } from "@/components/campaign-form"
import { ProposalForm } from "@/components/proposal-form"
import { SaveButton } from "@/components/save-button"
import { openCampaignCheckout } from "@/lib/razorpay-checkout"
import { formatCampaignRate, formatDate } from "@/lib/format"

const STATUS_OPTIONS = [
  { label: "Draft", value: "draft" },
  { label: "Active", value: "active" },
  { label: "Completed", value: "completed" },
  { label: "Cancelled", value: "cancelled" },
]

const STATUS_VARIANT = {
  draft: "secondary",
  active: "default",
  completed: "outline",
  cancelled: "destructive",
}

const APPLICATION_LABEL = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
}


export function CampaignCard({
  campaign,
  role,
  applicationStatus,
  saved = false,
  portfolioItems = [],
}) {
  const router = useRouter()
  const supabase = createClient()
  const statusOptions =
    campaign.funding_status === "paid"
      ? STATUS_OPTIONS
      : STATUS_OPTIONS.filter((option) => option.value !== "active")
  const [statusLoading, setStatusLoading] = useState(false)
  const [funding, setFunding] = useState(false)
  const [error, setError] = useState(null)

  async function handleStatusChange(nextStatus) {
    setError(null)
    setStatusLoading(true)
    const { error: updateError } = await supabase
      .from("campaigns")
      .update({ status: nextStatus, updated_at: new Date().toISOString() })
      .eq("id", campaign.id)
    setStatusLoading(false)

    if (updateError) {
      setError(updateError.message)
      return
    }

    router.refresh()
  }

  function handleFundCampaign() {
    setError(null)
    setFunding(true)
    openCampaignCheckout(campaign.id, {
      onSuccess: () => {
        setFunding(false)
        router.refresh()
      },
      onError: (message) => {
        setFunding(false)
        setError(message)
      },
    })
  }


  return (
    <Card>
      <CardHeader>
        <CardTitle>{campaign.title}</CardTitle>
        <CardDescription>{formatCampaignRate(campaign)}</CardDescription>
        <CardAction className="flex items-center gap-1">
          <Badge variant={STATUS_VARIANT[campaign.status] ?? "outline"}>
            {campaign.status}
          </Badge>
          {role === "clipper" && (
            <SaveButton type="campaign" targetId={campaign.id} initialSaved={saved} />
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {role === "clipper" && campaign.brand_name && (
          <div className="flex items-center gap-2">
            <Avatar className="size-5">
              <AvatarImage src={campaign.brand_logo_url} alt={campaign.brand_name} />
              <AvatarFallback className="text-[10px]">
                {campaign.brand_name[0]?.toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="text-xs text-muted-foreground">{campaign.brand_name}</span>
          </div>
        )}
        {campaign.description && (
          <p className="line-clamp-3 text-sm text-muted-foreground">{campaign.description}</p>
        )}
        {campaign.deadline && (
          <p className="text-xs text-muted-foreground">
            Deadline:{" "}
            {formatDate(campaign.deadline)}
          </p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
      <CardFooter className="gap-2">
        {role === "brand" && (
          <>
            <CampaignForm brandId={campaign.brand_id} campaign={campaign} />
            <div className="flex flex-col gap-1">
              <Select
                value={campaign.status}
                onValueChange={handleStatusChange}
                items={statusOptions}
                disabled={statusLoading}
              >
                <SelectTrigger size="sm" className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {statusOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              {campaign.funding_status !== "paid" && (
                <p className="text-xs text-muted-foreground">Fund the campaign to activate it.</p>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href={`/campaigns/${campaign.id}`} />}
            >
              Manage applicants
            </Button>
            {campaign.funding_status !== "paid" && (
              <Button size="sm" onClick={handleFundCampaign} disabled={funding}>
                {funding && <Spinner />}
                Fund campaign
              </Button>
            )}
          </>
        )}
        {role === "clipper" &&
          (applicationStatus ? (
            <Badge variant="outline">{APPLICATION_LABEL[applicationStatus] ?? applicationStatus}</Badge>
          ) : (
            <ProposalForm campaign={campaign} portfolioItems={portfolioItems} />
          ))}
      </CardFooter>
    </Card>
  );
}
