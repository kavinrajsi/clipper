"use client"

import { useState } from "react"
import { AdminRoleAction } from "@/components/admin-role-action"
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

function DetailRow({ label, children }) {
  return (
    <div className="grid grid-cols-3 gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="col-span-2">{children}</span>
    </div>
  );
}

export function AdminBrandsTable({ brands }) {
  const [selected, setSelected] = useState(null)

  return (
    <>
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead className="text-right">Campaigns</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {brands.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="h-24 text-center text-muted-foreground">
                  No brands yet.
                </TableCell>
              </TableRow>
            ) : (
              brands.map((brand) => (
                <TableRow
                  key={brand.id}
                  className="cursor-pointer"
                  onClick={() => setSelected(brand)}
                >
                  <TableCell className="font-medium">{brand.full_name ?? "—"}</TableCell>
                  <TableCell>{brand.email}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {brand.campaign_count}
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
            <SheetTitle>{selected?.full_name ?? "Brand"}</SheetTitle>
            <SheetDescription>{selected?.email}</SheetDescription>
          </SheetHeader>
          {selected && (
            <div className="flex flex-col gap-4 px-4">
              <DetailRow label="Campaigns">{selected.campaign_count}</DetailRow>
              <DetailRow label="Website">
                {selected.website ? (
                  <a
                    href={selected.website}
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-4"
                  >
                    {selected.website}
                  </a>
                ) : (
                  "—"
                )}
              </DetailRow>
              <DetailRow label="Industry">{selected.industry ?? "—"}</DetailRow>
              <DetailRow label="Font">{selected.font_name ?? "—"}</DetailRow>
              <DetailRow label="Color">
                {selected.color_code ? (
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="size-4 rounded-full border"
                      style={{ backgroundColor: selected.color_code }}
                    />
                    {selected.color_code}
                  </span>
                ) : (
                  "—"
                )}
              </DetailRow>
              {selected.description && (
                <div className="flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">Description</span>
                  <p>{selected.description}</p>
                </div>
              )}
              <div className="flex flex-col gap-1 border-t pt-4 text-sm">
                <span className="text-muted-foreground">Account type</span>
                <AdminRoleAction
                  userId={selected.id}
                  currentRole="brand"
                  onDone={() => setSelected(null)}
                />
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
