import Link from "next/link";
import { redirect } from "next/navigation";
import { BellIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

export default async function NotificationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/notifications");
  }

  const { data: notifications } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(100);

  const items = notifications ?? [];

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="mx-auto w-full max-w-3xl">
        <h1 className="text-2xl font-bold">Notifications</h1>
        <p className="text-sm text-muted-foreground">
          Everything that happened while you were away.
        </p>
      </div>

      <div className="mx-auto w-full max-w-3xl">
        {items.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BellIcon />
              </EmptyMedia>
              <EmptyTitle>Nothing yet</EmptyTitle>
              <EmptyDescription>
                We&apos;ll tell you when an application is reviewed, a clip is submitted, or a
                brand invites you.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="overflow-hidden rounded-lg border">
            {items.map((item) => (
              <li key={item.id} className="border-b last:border-b-0">
                <Link
                  href={item.url ?? "#"}
                  className={cn(
                    "flex flex-col gap-1 p-4 hover:bg-muted",
                    !item.read_at && "bg-muted/40"
                  )}
                >
                  <div className="flex items-center gap-2">
                    {!item.read_at && (
                      <span
                        className="size-2 shrink-0 rounded-full bg-primary"
                        aria-label="Unread"
                      />
                    )}
                    <span className="text-sm font-medium">{item.title}</span>
                  </div>
                  {item.body && (
                    <span className="text-sm text-muted-foreground">{item.body}</span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {item.actor_name ? `${item.actor_name} · ` : ""}
                    {formatRelativeTime(item.created_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
