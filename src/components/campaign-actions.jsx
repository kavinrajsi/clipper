"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { CampaignForm } from "@/components/campaign-form";
import { ProposalForm } from "@/components/proposal-form";
import { openCampaignCheckout } from "@/lib/razorpay-checkout";
import { APPLICATION_LABEL, campaignStatusOptions } from "@/lib/campaigns";

// The things you can DO to a campaign, lifted out of CampaignCard so the card
// and the table row render the same controls. A table you cannot act from is
// just a worse card grid, and two copies of a Razorpay checkout call would
// drift the first time either was touched.

export function CampaignBrandActions({ campaign, compact = false }) {
  const router = useRouter();
  const supabase = createClient();
  const statusOptions = campaignStatusOptions(campaign);
  const [statusLoading, setStatusLoading] = useState(false);
  const [funding, setFunding] = useState(false);
  const [error, setError] = useState(null);

  async function handleStatusChange(nextStatus) {
    setError(null);
    setStatusLoading(true);
    const { error: updateError } = await supabase
      .from("campaigns")
      .update({ status: nextStatus, updated_at: new Date().toISOString() })
      .eq("id", campaign.id);
    setStatusLoading(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    router.refresh();
  }

  function handleFundCampaign() {
    setError(null);
    setFunding(true);
    openCampaignCheckout(campaign.id, {
      onSuccess: () => {
        setFunding(false);
        router.refresh();
      },
      onError: (message) => {
        setFunding(false);
        setError(message);
      },
    });
  }

  return (
    <div className="flex flex-wrap items-start gap-2">
      <CampaignForm brandId={campaign.brand_id} campaign={campaign} />
      <div className="flex flex-col gap-1">
        <Select
          value={campaign.status}
          onValueChange={handleStatusChange}
          items={statusOptions}
          disabled={statusLoading}
        >
          <SelectTrigger size="sm" className={compact ? "w-32" : "w-36"}>
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
        {/* The table has a Funding column of its own, so the hint would just be
            repeating what the row already says. */}
        {!compact && campaign.funding_status !== "paid" && (
          <p className="text-xs text-muted-foreground">Fund the campaign to activate it.</p>
        )}
      </div>
      <Button
        variant="outline"
        size="sm"
        nativeButton={false}
        render={<Link href={`/campaigns/${campaign.id}`} />}
      >
        {compact ? "Applicants" : "Manage applicants"}
      </Button>
      {campaign.funding_status !== "paid" && (
        <Button size="sm" onClick={handleFundCampaign} disabled={funding}>
          {funding && <Spinner />}
          Fund campaign
        </Button>
      )}
      {error && <p className="w-full text-sm text-destructive">{error}</p>}
    </div>
  );
}

export function CampaignClipperActions({ campaign, applicationStatus, portfolioItems = [] }) {
  if (applicationStatus) {
    return (
      <Badge variant="outline">
        {APPLICATION_LABEL[applicationStatus] ?? applicationStatus}
      </Badge>
    );
  }

  return <ProposalForm campaign={campaign} portfolioItems={portfolioItems} />;
}
