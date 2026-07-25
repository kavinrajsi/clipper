import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value ?? 0)
}

export function AnalyticsSummaryCards({
  totalViews,
  watchTimeHours,
  subscribersGained,
  engagement,
}) {
  const cards = [
    { label: "Total Views", value: formatNumber(totalViews) },
    { label: "Watch Time (hrs)", value: formatNumber(watchTimeHours) },
    { label: "Subscribers Gained", value: formatNumber(subscribersGained) },
    { label: "Engagement", value: formatNumber(engagement) },
  ]

  return (
    <div className="grid grid-cols-1 gap-4 px-4 lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
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
