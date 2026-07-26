"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BellIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function NotificationBell({ initialNotifications = [], initialUnread = 0 }) {
  const supabase = createClient();
  const router = useRouter();
  const [items, setItems] = useState(initialNotifications);
  const [unread, setUnread] = useState(initialUnread);

  async function markAllRead() {
    if (unread === 0) return;
    // Optimistic — this is a read receipt, not a destructive action.
    const previous = items;
    const now = new Date().toISOString();
    setItems(items.map((i) => ({ ...i, read_at: i.read_at ?? now })));
    setUnread(0);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase
      .from("notifications")
      .update({ read_at: now })
      .eq("user_id", user.id)
      .is("read_at", null);

    if (error) {
      setItems(previous);
      setUnread(previous.filter((i) => !i.read_at).length);
      return;
    }
    router.refresh();
  }

  return (
    <DropdownMenu onOpenChange={(open) => open && markAllRead()}>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" className="relative" />}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
      >
        <BellIcon />
        {unread > 0 && (
          <Badge
            className="absolute -right-0.5 -top-0.5 size-4 justify-center rounded-full p-0 text-[10px] tabular-nums"
            aria-hidden
          >
            {unread > 9 ? "9+" : unread}
          </Badge>
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-sm font-medium">Notifications</span>
          <Link
            href="/notifications"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            See all
          </Link>
        </div>
        <DropdownMenuSeparator className="m-0" />

        {items.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            Nothing yet. We&apos;ll tell you when it&apos;s your turn.
          </p>
        ) : (
          <ul className="max-h-96 overflow-y-auto">
            {items.map((item) => (
              <li key={item.id}>
                <Link
                  href={item.url ?? "/notifications"}
                  className={cn(
                    "flex flex-col gap-0.5 border-b px-3 py-2 text-sm last:border-b-0 hover:bg-muted",
                    !item.read_at && "bg-muted/40"
                  )}
                >
                  <span className="font-medium">{item.title}</span>
                  {item.body && (
                    <span className="line-clamp-2 text-xs text-muted-foreground">{item.body}</span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {formatRelativeTime(item.created_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
