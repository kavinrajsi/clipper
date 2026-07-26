"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { SendIcon } from "lucide-react";
import { useRealtimeMessages } from "@/hooks/use-realtime-messages";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageGroup,
} from "@/components/ui/message";
import { Marker, MarkerContent } from "@/components/ui/marker";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";

function initials(name) {
  if (!name) return "?";
  return name.split(" ").filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join("");
}

function sameDay(a, b) {
  if (!a || !b) return false;
  return new Date(a).toDateString() === new Date(b).toDateString();
}

export function ConversationThread({ conversationId, initialMessages, viewerId, people }) {
  const supabase = createClient();
  const router = useRouter();
  const [messages, setMessages] = useRealtimeMessages(conversationId, initialMessages);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  async function send(event) {
    event.preventDefault();
    const text = body.trim();
    if (!text || sending) return;

    setSending(true);
    // Optimistic: a message that appears sent but wasn't is the worst bug in a
    // chat product, so the temporary row is removed again on failure and the
    // text is handed back rather than lost.
    const optimisticId = `optimistic-${Date.now()}`;
    setMessages((current) => [
      ...current,
      {
        id: optimisticId,
        conversation_id: conversationId,
        sender_id: viewerId,
        body: text,
        created_at: new Date().toISOString(),
        pending: true,
      },
    ]);
    setBody("");

    const { error } = await supabase
      .from("messages")
      .insert({ conversation_id: conversationId, sender_id: viewerId, body: text });

    setSending(false);

    if (error) {
      setMessages((current) => current.filter((m) => m.id !== optimisticId));
      setBody(text);
      toast.error("Message didn't send. Try again.");
      return;
    }

    // The realtime INSERT replaces the optimistic row by id; drop it now so the
    // two never render side by side.
    setMessages((current) => current.filter((m) => m.id !== optimisticId));
    router.refresh();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto p-4">
        <MessageGroup>
          {messages.map((message, index) => {
            const mine = message.sender_id === viewerId;
            const person = people[message.sender_id];
            const previous = messages[index - 1];
            const showDay = !sameDay(previous?.created_at, message.created_at);

            return (
              <div key={message.id} className="flex flex-col gap-2">
                {showDay && (
                  <Marker>
                    <MarkerContent>{formatDateTime(message.created_at)}</MarkerContent>
                  </Marker>
                )}
                <Message align={mine ? "end" : "start"}>
                  <MessageAvatar>
                    <Avatar className="size-8">
                      <AvatarImage src={person?.avatar_url} alt={person?.full_name ?? ""} />
                      <AvatarFallback>{initials(person?.full_name)}</AvatarFallback>
                    </Avatar>
                  </MessageAvatar>
                  <MessageContent>
                    {/* Bubble has no sent/received variants — primary for your
                        own messages, muted for theirs. */}
                    <Bubble variant={mine ? "default" : "muted"}>
                      <BubbleContent className="whitespace-pre-wrap">{message.body}</BubbleContent>
                    </Bubble>
                    <MessageFooter className={message.pending ? "opacity-60" : undefined}>
                      {message.pending ? "Sending…" : formatRelativeTime(message.created_at)}
                    </MessageFooter>
                  </MessageContent>
                </Message>
              </div>
            );
          })}
        </MessageGroup>

        {messages.length === 0 && (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No messages yet. Ask a question about the brief — that&apos;s what this is for.
          </p>
        )}
      </div>

      <form onSubmit={send} className="flex items-end gap-2 border-t p-4">
        <Textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends, Shift+Enter breaks the line — the convention people
            // already have from every other chat product.
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send(event);
            }
          }}
          rows={2}
          placeholder="Write a message…"
          className="min-h-0 resize-none"
        />
        <Button type="submit" size="icon" disabled={sending || !body.trim()} aria-label="Send">
          {sending ? <Spinner /> : <SendIcon />}
        </Button>
      </form>
    </div>
  );
}
