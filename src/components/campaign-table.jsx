import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CampaignBrandActions, CampaignClipperActions } from "@/components/campaign-actions";
import { SaveButton } from "@/components/save-button";
import { APPLICATION_LABEL, CAMPAIGN_STATUS_VARIANT } from "@/lib/campaigns";
import { formatCampaignRate, formatDate } from "@/lib/format";

// No "use client" and no tanstack. my-applications-table.jsx already shows the
// shadcn primitives working with no client boundary at all, and nothing here
// sorts or paginates yet — the two client bits (actions, save) bring their own
// boundaries.

const FUNDING_LABEL = {
  paid: "Funded",
  pending: "Pending",
  unpaid: "Not funded",
};

export function CampaignTable({
  campaigns = [],
  role,
  applicationByCampaign = {},
  savedCampaignIds,
  portfolioItems = [],
}) {
  const isBrand = role === "brand";

  return (
    // Wide content scrolls inside its own container rather than pushing the
    // page sideways on a phone.
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Campaign</TableHead>
            {!isBrand && <TableHead>Brand</TableHead>}
            <TableHead>Rate</TableHead>
            {isBrand && <TableHead>Status</TableHead>}
            {isBrand && <TableHead>Funding</TableHead>}
            <TableHead>Deadline</TableHead>
            {!isBrand && <TableHead>Application</TableHead>}
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {campaigns.length === 0 ? (
            <TableRow>
              {/* Both roles have six columns; they are just different six. */}
              <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                {isBrand
                  ? "No campaigns yet — create one to get started."
                  : "No active campaigns right now — check back soon."}
              </TableCell>
            </TableRow>
          ) : (
            campaigns.map((campaign) => (
              <TableRow key={campaign.id}>
                <TableCell className="font-medium">
                  {isBrand ? (
                    <Link
                      href={`/campaigns/${campaign.id}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {campaign.title}
                    </Link>
                  ) : (
                    campaign.title
                  )}
                </TableCell>

                {!isBrand && (
                  <TableCell>
                    {campaign.brand_name ? (
                      <span className="flex items-center gap-2">
                        <Avatar className="size-5">
                          <AvatarImage
                            src={campaign.brand_logo_url}
                            alt={campaign.brand_name}
                          />
                          <AvatarFallback className="text-[10px]">
                            {campaign.brand_name[0]?.toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        {campaign.brand_name}
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                )}

                <TableCell>{formatCampaignRate(campaign)}</TableCell>

                {isBrand && (
                  <TableCell>
                    <Badge variant={CAMPAIGN_STATUS_VARIANT[campaign.status] ?? "outline"}>
                      {campaign.status}
                    </Badge>
                  </TableCell>
                )}

                {isBrand && (
                  <TableCell className="text-muted-foreground">
                    {FUNDING_LABEL[campaign.funding_status] ?? campaign.funding_status ?? "—"}
                  </TableCell>
                )}

                <TableCell>{formatDate(campaign.deadline, { fallback: "—" })}</TableCell>

                {/* Status of an application you already sent. Applying is an
                    action and lives in the Actions cell, so this column stays
                    a plain read — rendering CampaignClipperActions in both
                    would put two Apply buttons on the same row. */}
                {!isBrand && (
                  <TableCell>
                    {applicationByCampaign[campaign.id] ? (
                      <Badge variant="outline">
                        {APPLICATION_LABEL[applicationByCampaign[campaign.id]] ??
                          applicationByCampaign[campaign.id]}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                )}

                <TableCell>
                  <div className="flex items-center justify-end gap-2">
                    {isBrand ? (
                      <CampaignBrandActions campaign={campaign} compact />
                    ) : (
                      <>
                        <SaveButton
                          type="campaign"
                          targetId={campaign.id}
                          initialSaved={savedCampaignIds?.has(campaign.id) ?? false}
                        />
                        {/* No applicationStatus passed: when there is one the
                            Application column already shows it, and this cell
                            would render the same badge a second time. */}
                        {!applicationByCampaign[campaign.id] && (
                          <CampaignClipperActions
                            campaign={campaign}
                            portfolioItems={portfolioItems}
                          />
                        )}
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
