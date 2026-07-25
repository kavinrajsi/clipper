import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export function AdminBrandsTable({ brands }) {
  return (
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
              <TableRow key={brand.id}>
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
  );
}
