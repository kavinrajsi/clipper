import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

function formatDate(value) {
  if (!value) return "Never"
  return new Date(value).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
}

export function AdminClippersTable({ clippers }) {
  return (
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
              <TableRow key={clipper.id}>
                <TableCell className="font-medium">{clipper.full_name ?? "—"}</TableCell>
                <TableCell>{clipper.email}</TableCell>
                <TableCell>{clipper.channel_title ?? "Not connected"}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {new Intl.NumberFormat("en-IN").format(clipper.total_views ?? 0)}
                </TableCell>
                <TableCell className="text-right">{formatDate(clipper.last_synced_at)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
