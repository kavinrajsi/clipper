"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckIcon, CheckCheckIcon } from "lucide-react";
import { toast } from "sonner";
import { useNotifications } from "@/components/notification-provider";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Owns the 100-row list so the page can stay a Server Component doing the
// query. The writes go through NotificationProvider, which holds the counter
// the bell badge and the sidebar badge both render — marking a row read here
// has to move that number or the two badges lie.
export function NotificationList({ initialItems = [], filter }) {
  const { unread, markRead, markAllRead } = useNotifications();
  const [items, setItems] = useState(initialItems);
  const [busy, setBusy] = useState(null);

  const hasUnread = items.some((item) => !item.read_at);

  async function handleMarkRead(id) {
    if (busy) return;
    setBusy(id);

    const now = new Date().toISOString();
    const previous = items;
    setItems(items.map((item) => (item.id === id ? { ...item, read_at: now } : item)));

    const ok = await markRead(id);
    setBusy(null);

    if (!ok) {
      setItems(previous);
      toast.error("Couldn't mark that as read.");
    }
  }

  async function handleMarkAll() {
    if (busy) return;
    setBusy("all");

    const now = new Date().toISOString();
    const previous = items;
    setItems(items.map((item) => ({ ...item, read_at: item.read_at ?? now })));

    const ok = await markAllRead();
    setBusy(null);

    if (!ok) {
      setItems(previous);
      toast.error("Couldn't mark those as read.");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <nav className="flex items-center gap-1" aria-label="Filter notifications">
          <FilterTab href="/notifications" active={filter === "all"}>
            All
          </FilterTab>
          <FilterTab href="/notifications?filter=unread" active={filter === "unread"}>
            {/* From the provider, not a server count: this list updates
                optimistically and deliberately does not refresh, so a
                server-rendered number would be wrong the moment a row is
                cleared. */}
            Unread{unread > 0 ? ` (${unread})` : ""}
          </FilterTab>
        </nav>

        {/* Disabled off this list's rows, not the provider's counter — opening
            the bell zeroes that counter while the dots here are still on
            screen. */}
        <Button
          variant="outline"
          size="sm"
          onClick={handleMarkAll}
          disabled={!hasUnread || busy === "all"}
        >
          <CheckCheckIcon />
          Mark all as read
        </Button>
      </div>

      <ul className="overflow-hidden rounded-lg border">
        {items.map((item) => (
          <li
            key={item.id}
            className={cn(
              "flex items-start gap-2 border-b pr-2 last:border-b-0",
              !item.read_at && "bg-muted/40"
            )}
          >
            {/* The link and the button are siblings. Nesting a button inside
                the link would be invalid HTML and would navigate on click. */}
            <Link href={item.url ?? "#"} className="flex flex-1 flex-col gap-1 p-4 hover:bg-muted">
              <div className="flex items-center gap-2">
                {!item.read_at && (
                  <span className="size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />
                )}
                <span className="text-sm font-medium">{item.title}</span>
              </div>
              {item.body && <span className="text-sm text-muted-foreground">{item.body}</span>}
              <span className="text-xs text-muted-foreground">
                {item.actor_name ? `${item.actor_name} · ` : ""}
                {formatRelativeTime(item.created_at)}
              </span>
            </Link>

            {!item.read_at && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="mt-3 shrink-0"
                      onClick={() => handleMarkRead(item.id)}
                      disabled={busy === item.id}
                      aria-label={`Mark "${item.title}" as read`}
                    />
                  }
                >
                  <CheckIcon />
                </TooltipTrigger>
                <TooltipContent>Mark as read</TooltipContent>
              </Tooltip>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function FilterTab({ href, active, children }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "rounded-md px-3 py-1.5 text-sm transition-colors",
        active ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60"
      )}
    >
      {children}
    </Link>
  );
}
