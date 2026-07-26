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
import { formatDate, formatNumber } from "@/lib/format"

function DetailRow({ label, children }) {
  return (
    <div className="grid grid-cols-3 gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="col-span-2">{children}</span>
    </div>
  );
}

export function AdminClippersTable({ clippers }) {
  const [selected, setSelected] = useState(null)

  return (
    <>
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Channel</TableHead>
              <TableHead className="text-right">Total Views</TableHead>
              <TableHead className="text-right">Last Synced</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clippers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                  No clippers yet.
                </TableCell>
              </TableRow>
            ) : (
              clippers.map((clipper) => (
                <TableRow
                  key={clipper.id}
                  className="cursor-pointer"
                  onClick={() => setSelected(clipper)}
                >
                  <TableCell className="font-medium">{clipper.full_name ?? "—"}</TableCell>
                  <TableCell>{clipper.email}</TableCell>
                  <TableCell>{clipper.channel_title ?? "Not connected"}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(clipper.total_views)}
                  </TableCell>
                  <TableCell className="text-right">{formatDate(clipper.last_synced_at, { fallback: "Never" })}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{selected?.full_name ?? "Clipper"}</SheetTitle>
            <SheetDescription>{selected?.email}</SheetDescription>
          </SheetHeader>
          {selected && (
            <div className="flex flex-col gap-4 px-4">
              <DetailRow label="Channel">{selected.channel_title ?? "Not connected"}</DetailRow>
              <DetailRow label="Total views">
                {formatNumber(selected.total_views)}
              </DetailRow>
              <DetailRow label="Last synced">{formatDate(selected.last_synced_at, { fallback: "Never" })}</DetailRow>
              <DetailRow label="Availability">
                {selected.availability_status ? (
                  <Badge variant="outline">{selected.availability_status}</Badge>
                ) : (
                  "—"
                )}
              </DetailRow>
              <DetailRow label="Pricing">
                {selected.pricing_model
                  ? `${selected.pricing_model}${selected.rate_amount ? ` — ₹${selected.rate_amount}` : ""}`
                  : "—"}
              </DetailRow>
              <DetailRow label="Categories">
                {selected.categories?.length ? selected.categories.join(", ") : "—"}
              </DetailRow>
              <DetailRow label="Style">
                {selected.style_tags?.length ? selected.style_tags.join(", ") : "—"}
              </DetailRow>
              {selected.bio && (
                <div className="flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">Bio</span>
                  <p>{selected.bio}</p>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
