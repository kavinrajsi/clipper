import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatCurrency, formatDate } from "@/lib/format"

const STATUS_VARIANT = {
  pending: "secondary",
  held: "secondary",
  released: "default",
  failed: "destructive",
}

export function AdminPayoutsTable({ payouts }) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Clipper</TableHead>
            <TableHead>Campaign</TableHead>
            <TableHead>To clipper</TableHead>
            <TableHead>Platform fee</TableHead>
            <TableHead>Brand charged</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Held at</TableHead>
            <TableHead>Released at</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {payouts.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                No payouts yet.
              </TableCell>
            </TableRow>
          ) : (
            payouts.map((payout) => (
              <TableRow key={payout.id}>
                <TableCell className="font-medium">
                  {payout.clipper_name ?? payout.clipper_email}
                </TableCell>
                <TableCell>{payout.campaign_title ?? "—"}</TableCell>
                <TableCell>{formatCurrency(payout.amount ?? 0)}</TableCell>
                <TableCell className="text-muted-foreground">
                  {formatCurrency(payout.platform_fee_amount ?? 0)}
                </TableCell>
                {/* What the campaign budget actually gave up. The clipper is
                    never charged the fee — the brand pays it on top. */}
                <TableCell>
                  {formatCurrency(Number(payout.amount ?? 0) + Number(payout.platform_fee_amount ?? 0))}
                </TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[payout.status] ?? "outline"}>
                    {payout.status}
                  </Badge>
                </TableCell>
                <TableCell>{formatDate(payout.held_at)}</TableCell>
                <TableCell>{formatDate(payout.released_at)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
