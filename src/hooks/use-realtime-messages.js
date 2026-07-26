"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// First Realtime subscription in this codebase, so it sets the convention.
//
// Two things that are easy to get wrong and are handled here:
//
//   1. BACKFILL ON RESUBSCRIBE. A dropped connection means missed INSERTs, and
//      the subscription does not replay them. Without a catch-up fetch a flaky
//      network silently loses messages, which is the worst possible bug in a
//      chat product. Every (re)subscribe refetches anything newer than what we
//      already hold.
//
//   2. RLS GOVERNS REALTIME. The postgres_changes stream is filtered by the
//      same policies as REST, so a participant only ever receives their own
//      conversations. The channel filter below is an optimisation, not the
//      security boundary — `can_access_conversation` is.
export function useRealtimeMessages(conversationId, initialMessages = []) {
  const [messages, setMessages] = useState(initialMessages);
  // Ref, not state: the backfill reads it inside an effect that must not
  // re-run every time a message arrives.
  const latestRef = useRef(initialMessages.at(-1)?.created_at ?? null);

  useEffect(() => {
    if (!conversationId) return undefined;

    const supabase = createClient();
    let cancelled = false;

    function append(message) {
      setMessages((current) => {
        if (current.some((m) => m.id === message.id)) return current;
        latestRef.current = message.created_at;
        return [...current, message];
      });
    }

    async function backfill() {
      let query = supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });

      if (latestRef.current) query = query.gt("created_at", latestRef.current);

      const { data } = await query;
      if (cancelled || !data?.length) return;
      data.forEach(append);
    }

    const channel = supabase
      .channel(`messages:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => append(payload.new)
      )
      .subscribe((status) => {
        // Fires on first connect and on every automatic reconnect.
        if (status === "SUBSCRIBED") backfill();
      });

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [conversationId]);

  return [messages, setMessages];
}
