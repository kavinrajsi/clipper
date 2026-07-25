import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { SubmissionForm } from "@/components/submission-form"

const STATUS_VARIANT = {
  pending: "secondary",
  approved: "default",
  rejected: "destructive",
}

const SUBMISSION_STATUS_VARIANT = {
  submitted: "secondary",
  approved: "default",
  rejected: "destructive",
}

function formatRate(campaign) {
  const amount = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
  }).format(campaign?.payout_rate ?? 0)
  return campaign?.payout_structure === "flat_fee" ? `${amount} flat` : `${amount} / 1,000 views`
}

export function MyApplicationsTable({ applications }) {
  return (
    <div className="px-4 lg:px-6">
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Campaign</TableHead>
              <TableHead>Payout</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Submission</TableHead>
              <TableHead className="text-right">Applied</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {applications.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                  You haven&apos;t applied to any campaigns yet.
                </TableCell>
              </TableRow>
            ) : (
              applications.map((application) => (
                <TableRow key={application.id}>
                  <TableCell className="font-medium">
                    {application.campaign?.title ?? "Unknown campaign"}
                  </TableCell>
                  <TableCell>{formatRate(application.campaign)}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[application.status] ?? "outline"}>
                      {application.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {application.submission ? (
                      <Badge
                        variant={
                          SUBMISSION_STATUS_VARIANT[application.submission.status] ?? "outline"
                        }
                      >
                        {application.submission.status}
                      </Badge>
                    ) : application.status === "approved" ? (
                      <SubmissionForm applicationId={application.id} />
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {new Date(application.created_at).toLocaleDateString("en-IN", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
