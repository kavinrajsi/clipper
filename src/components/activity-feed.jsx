import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ActivityIcon,
  HeartIcon,
  ListPlusIcon,
  MessageCircleIcon,
  ThumbsUpIcon,
  UploadIcon,
  UserPlusIcon,
} from "lucide-react"

const TYPE_ICON = {
  upload: UploadIcon,
  like: ThumbsUpIcon,
  favorite: HeartIcon,
  comment: MessageCircleIcon,
  subscription: UserPlusIcon,
  playlistItem: ListPlusIcon,
}

function formatDate(value) {
  if (!value) return ""
  return new Date(value).toLocaleDateString("en-IN", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

export function ActivityFeed({ activities }) {
  return (
    <Card className="mx-4 lg:mx-6">
      <CardHeader>
        <CardTitle>Recent Activity</CardTitle>
        <CardDescription>Uploads, likes, comments, and more from your channel</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {activities.length === 0 && (
          <p className="text-sm text-muted-foreground">No activity synced yet.</p>
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
                {formatDate(activity.published_at)}
              </span>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
