"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { playNotificationSound } from "@/lib/notification-sound";

// One subscription for the whole protected shell, and the state the bell and
// the sidebar badge both read from.
//
// WHY A PROVIDER RATHER THAN router.refresh()
// NotificationBell seeds its state with useState(initialNotifications), so it
// ignores prop changes after mount — router.refresh() re-renders the server
// tree into the same client component position without remounting, and the
// bell would never resync. A refresh per notification also refetches the
// profile, the workspaces, both notification queries and the whole current
// page; during an active chat that is one full round trip per message.
//
// The conventions here are the ones use-realtime-messages.js established:
// INSERT-only postgres_changes, a channel filter that is an optimisation and
// not the security boundary (RLS is), and a catch-up fetch on every
// (re)subscribe because a dropped connection does not replay what it missed.
//
// NO SELF-NOTIFICATION FILTERING IS NEEDED. emit_notification returns early
// when the actor is the recipient, and the table carries
// `check (actor_id is null or actor_id <> user_id)`. Every row that can arrive
// here is about somebody else's action, so the chime can never fire on the
// viewer's own send.

const NotificationContext = createContext(null);

// Matches the layout's `.limit(10)` — the bell dropdown shows a preview, not a
// history. /notifications is the full list.
const PREVIEW_LIMIT = 10;

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error("useNotifications must be used inside <NotificationProvider>");
  }
  return context;
}

export function NotificationProvider({
  userId,
  initialNotifications = [],
  initialUnread = 0,
  initialSoundEnabled = true,
  children,
}) {
  const router = useRouter();
  const [notifications, setNotifications] = useState(initialNotifications);
  const [unread, setUnread] = useState(initialUnread);
  const [soundEnabled, setSoundEnabledState] = useState(initialSoundEnabled);

  // Read inside the subscription effect, so toggling the sound does not tear
  // down and rebuild the channel.
  const soundRef = useRef(initialSoundEnabled);
  const setSoundEnabled = useCallback((next) => {
    soundRef.current = next;
    setSoundEnabledState(next);
  }, []);

  // Refs, not state: the backfill and the dedupe both run inside an effect
  // that must not re-run every time a notification arrives.
  const latestRef = useRef(initialNotifications[0]?.created_at ?? null);
  const seenRef = useRef(new Set(initialNotifications.map((n) => n.id)));

  // Marks one notification read. The badge counter lives here, so a per-item
  // write on /notifications has to come through the provider or the bell and
  // the sidebar both go stale the moment a row is cleared.
  const markRead = useCallback(
    async (id) => {
      let wasUnread = false;

      // The provider holds a PREVIEW_LIMIT-sized slice while /notifications
      // shows 100, so most ids are not in this list. That is fine — the
      // counter is the part that always has to move.
      setNotifications((current) =>
        current.map((n) => {
          if (n.id !== id || n.read_at) return n;
          wasUnread = true;
          return { ...n, read_at: new Date().toISOString() };
        })
      );
      setUnread((count) => Math.max(0, count - 1));

      const supabase = createClient();
      const { error } = await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", id)
        .eq("user_id", userId)
        // Makes a double-click a no-op rather than a second decrement.
        .is("read_at", null);

      if (error) {
        setUnread((count) => count + 1);
        if (wasUnread) {
          setNotifications((current) =>
            current.map((n) => (n.id === id ? { ...n, read_at: null } : n))
          );
        }
        return false;
      }

      return true;
    },
    [userId]
  );

  const markAllRead = useCallback(async () => {
    // No `unread === 0` guard on purpose. Opening the bell sets this counter
    // to 0, so someone who glanced at the dropdown and then walked to
    // /notifications has a provider that believes nothing is unread while the
    // page's own query still shows unread rows — and the page's button would
    // silently no-op. The `.is("read_at", null)` filter below already makes a
    // redundant call cheap.

    // Optimistic — this is a read receipt, not a destructive action.
    const previous = notifications;
    const previousUnread = unread;
    const now = new Date().toISOString();
    setNotifications(previous.map((n) => ({ ...n, read_at: n.read_at ?? now })));
    setUnread(0);

    const supabase = createClient();
    const { error } = await supabase
      .from("notifications")
      .update({ read_at: now })
      .eq("user_id", userId)
      .is("read_at", null);

    if (error) {
      setNotifications(previous);
      setUnread(previousUnread);
      return false;
    }

    // Server-rendered read state lives outside this context — the unread dots
    // on /notifications are one. Once per dropdown-open is nothing like the
    // refresh-per-message this provider exists to avoid.
    router.refresh();
    return true;
  }, [notifications, router, unread, userId]);

  useEffect(() => {
    if (!userId) return undefined;

    const supabase = createClient();
    let cancelled = false;

    function receive(notification, { chime }) {
      if (seenRef.current.has(notification.id)) return;
      seenRef.current.add(notification.id);

      if (
        !latestRef.current ||
        new Date(notification.created_at) > new Date(latestRef.current)
      ) {
        latestRef.current = notification.created_at;
      }

      setNotifications((current) =>
        [notification, ...current].slice(0, PREVIEW_LIMIT)
      );
      if (!notification.read_at) setUnread((count) => count + 1);

      if (chime && soundRef.current) playNotificationSound();
    }

    async function backfill() {
      let query = supabase
        .from("notifications")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(PREVIEW_LIMIT);

      if (latestRef.current) query = query.gt("created_at", latestRef.current);

      const { data } = await query;
      if (cancelled || !data?.length) return;

      // Oldest first so the newest ends up at the head of the list.
      //
      // Silent on purpose. These are rows that arrived while the connection
      // was down; the badge should catch up but the user should not get a
      // burst of chimes for things that happened minutes ago — and on a first
      // subscribe with no prior notifications this query returns their entire
      // history, which must not announce itself.
      [...data].reverse().forEach((row) => receive(row, { chime: false }));
    }

    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => receive(payload.new, { chime: true })
      )
      .subscribe((status) => {
        // Fires on first connect and on every automatic reconnect.
        if (status === "SUBSCRIBED") backfill();
      });

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [userId]);

  return (
    <NotificationContext.Provider
      value={{ notifications, unread, markRead, markAllRead, soundEnabled, setSoundEnabled }}
    >
      {children}
    </NotificationContext.Provider>
  );
}
