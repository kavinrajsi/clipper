import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const STATUS_VARIANT = {
  draft: "secondary",
  active: "default",
  completed: "outline",
  cancelled: "destructive",
}

function formatRate(campaign) {
  const amount = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
  }).format(campaign.payout_rate ?? 0)
  return campaign.payout_structure === "flat_fee" ? `${amount} flat` : `${amount} / 1,000 views`
}

export function AdminCampaignsTable({ campaigns }) {
  return (
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
              <TableRow key={campaign.id}>
                <TableCell className="font-medium">{campaign.title}</TableCell>
                <TableCell>{campaign.brand_name ?? campaign.brand_email}</TableCell>
                <TableCell>{formatRate(campaign)}</TableCell>
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
  );
}
