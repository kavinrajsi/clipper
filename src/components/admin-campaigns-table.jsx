"use client"

import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatCampaignRate, formatCurrency, formatDate } from "@/lib/format"

const STATUS_VARIANT = {
  draft: "secondary",
  active: "default",
  completed: "outline",
  cancelled: "destructive",
}

function DetailRow({ label, children }) {
  return (
    <div className="grid grid-cols-3 gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="col-span-2">{children}</span>
    </div>
  );
}

export function AdminCampaignsTable({ campaigns }) {
  const [selected, setSelected] = useState(null)

  return (
    <>
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Campaign</TableHead>
              <TableHead>Brand</TableHead>
              <TableHead>Payout</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Applicants</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {campaigns.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                  No campaigns yet.
                </TableCell>
              </TableRow>
            ) : (
              campaigns.map((campaign) => (
                <TableRow
                  key={campaign.id}
                  className="cursor-pointer"
                  onClick={() => setSelected(campaign)}
                >
                  <TableCell className="font-medium">{campaign.title}</TableCell>
                  <TableCell>{campaign.brand_name ?? campaign.brand_email}</TableCell>
                  <TableCell>{formatCampaignRate(campaign)}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[campaign.status] ?? "outline"}>
                      {campaign.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {campaign.applicant_count}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{selected?.title}</SheetTitle>
            <SheetDescription>{selected?.brand_name ?? selected?.brand_email}</SheetDescription>
          </SheetHeader>
          {selected && (
            <div className="flex flex-col gap-4 px-4">
              <DetailRow label="Status">
                <Badge variant={STATUS_VARIANT[selected.status] ?? "outline"}>
                  {selected.status}
                </Badge>
              </DetailRow>
              <DetailRow label="Funding">{selected.funding_status}</DetailRow>
              <DetailRow label="Payout">{formatCampaignRate(selected)}</DetailRow>
              <DetailRow label="Budget">{formatCurrency(selected.budget)}</DetailRow>
              <DetailRow label="Deadline">{formatDate(selected.deadline)}</DetailRow>
              <DetailRow label="Created">{formatDate(selected.created_at)}</DetailRow>
              <DetailRow label="Applicants">{selected.applicant_count}</DetailRow>
              {selected.description && (
                <div className="flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">Description</span>
                  <p>{selected.description}</p>
                </div>
              )}
              {selected.requirements && (
                <div className="flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">Content requirements</span>
                  <p>{selected.requirements}</p>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
