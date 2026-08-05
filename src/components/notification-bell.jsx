"use client";

import Link from "next/link";
import { BellIcon } from "lucide-react";
import { useNotifications } from "@/components/notification-provider";
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

// State and the Realtime subscription live in NotificationProvider so the
// sidebar badge reads the same counter — see the note there on why this cannot
// be props plus router.refresh().
export function NotificationBell() {
  const { notifications: items, unread, markAllRead } = useNotifications();

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
