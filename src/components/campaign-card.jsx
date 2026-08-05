"use client"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { CampaignBrandActions, CampaignClipperActions } from "@/components/campaign-actions"
import { SaveButton } from "@/components/save-button"
import { CAMPAIGN_STATUS_VARIANT } from "@/lib/campaigns"
import { formatCampaignRate, formatDate } from "@/lib/format"

// Presentation only. Everything actionable lives in campaign-actions.jsx so
// the table row renders the identical controls — see the note there.
export function CampaignCard({
  campaign,
  role,
  applicationStatus,
  saved = false,
  portfolioItems = [],
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{campaign.title}</CardTitle>
        <CardDescription>{formatCampaignRate(campaign)}</CardDescription>
        <CardAction className="flex items-center gap-1">
          <Badge variant={CAMPAIGN_STATUS_VARIANT[campaign.status] ?? "outline"}>
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
      </CardContent>
      <CardFooter className="gap-2">
        {role === "brand" && <CampaignBrandActions campaign={campaign} />}
        {role === "clipper" && (
          <CampaignClipperActions
            campaign={campaign}
            applicationStatus={applicationStatus}
            portfolioItems={portfolioItems}
          />
        )}
      </CardFooter>
    </Card>
  );
}
