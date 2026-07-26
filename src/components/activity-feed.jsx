import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import {
  ActivityIcon,
  HeartIcon,
  ListPlusIcon,
  MessageCircleIcon,
  ThumbsUpIcon,
  UploadIcon,
  UserPlusIcon,
} from "lucide-react"
import { formatDate } from "@/lib/format"

const TYPE_ICON = {
  upload: UploadIcon,
  like: ThumbsUpIcon,
  favorite: HeartIcon,
  comment: MessageCircleIcon,
  subscription: UserPlusIcon,
  playlistItem: ListPlusIcon,
}


export function ActivityFeed({ activities }) {
  return (
    <Card className="mx-4 lg:mx-6">
      <CardHeader>
        <CardTitle>Recent Activity</CardTitle>
        <CardDescription>Uploads, likes, comments, and more from your channel</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {/* Inside a card that already has its own title, so no EmptyMedia icon
            here — the section is labelled, and an icon would just repeat it. */}
        {activities.length === 0 && (
          <Empty className="py-6">
            <EmptyHeader>
              <EmptyTitle>No activity synced yet</EmptyTitle>
              <EmptyDescription>
                Uploads, likes, and comments appear here after you sync your
                channel from Connectors.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {activities.map((activity) => {
          const Icon = TYPE_ICON[activity.type] ?? ActivityIcon
          return (
            <div key={activity.id} className="flex items-start gap-3">
              <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="flex-1 text-sm">
                <p className="font-medium">{activity.title}</p>
                {activity.description && (
                  <p className="line-clamp-2 text-muted-foreground">{activity.description}</p>
                )}
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatDate(activity.published_at, { fallback: "", style: "medium" })}
              </span>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
