import Link from "next/link";
import { redirect } from "next/navigation";
import { BellIcon, CheckCheckIcon } from "lucide-react";
import { NotificationList } from "@/components/notification-list";
import { NotificationSoundToggle } from "@/components/notification-sound-toggle";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

const FILTERS = ["all", "unread"];

export default async function NotificationsPage({ searchParams }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/notifications");
  }

  // Validated rather than branched on directly — it comes off the query string.
  const params = await searchParams;
  const requested = Array.isArray(params?.filter) ? params.filter[0] : params?.filter;
  const filter = FILTERS.includes(requested) ? requested : "all";

  let query = supabase
    .from("notifications")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(100);

  if (filter === "unread") query = query.is("read_at", null);

  const { data: notifications } = await query;
  const items = notifications ?? [];

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="mx-auto flex w-full max-w-3xl items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Notifications</h1>
          <p className="text-sm text-muted-foreground">
            Everything that happened while you were away.
          </p>
        </div>
        <NotificationSoundToggle />
      </div>

      <div className="mx-auto w-full max-w-3xl">
        {items.length === 0 ? (
          // Two distinct states. "Nothing yet" is plainly wrong to show
          // someone who has a hundred notifications and has read them all.
          filter === "unread" ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CheckCheckIcon />
                </EmptyMedia>
                <EmptyTitle>Nothing unread</EmptyTitle>
                <EmptyDescription>You&apos;re all caught up.</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button variant="outline" nativeButton={false} render={<Link href="/notifications" />}>
                  See everything
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
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
          )
        ) : (
          <NotificationList initialItems={items} filter={filter} />
        )}
      </div>
    </div>
  );
}
