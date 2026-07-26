import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value ?? 0)
}

export function DashboardSummaryCards({
  totalViews,
  videosSynced,
  pendingApplications,
  approvedCampaigns,
}) {
  const cards = [
    { label: "Total Views", value: formatNumber(totalViews) },
    { label: "Videos Synced", value: formatNumber(videosSynced) },
    { label: "Pending Applications", value: formatNumber(pendingApplications) },
    { label: "Approved Campaigns", value: formatNumber(approvedCampaigns) },
  ]

  return (
    <div className="grid grid-cols-2 gap-4 px-4 lg:grid-cols-4 lg:px-6">
      {cards.map((card) => (
        <Card key={card.label} className="@container/card">
          <CardHeader>
            <CardDescription>{card.label}</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
              {card.value}
            </CardTitle>
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}
