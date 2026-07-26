import Link from "next/link";
import { redirect } from "next/navigation";
import { MessagesSquareIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatRelativeTime } from "@/lib/format";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

export default async function MessagesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/messages");
  }

  // RLS (can_access_conversation) already limits this to threads the caller is
  // part of — as the clipper, or as a member of the campaign's workspace.
  const { data: conversationRows } = await supabase
    .from("conversations")
    .select("*, application:campaign_applications(clipper_id), campaign:campaigns(id, title)")
    .order("last_message_at", { ascending: false, nullsFirst: false });

  const conversations = conversationRows ?? [];

  const counterpartIds = [
    ...new Set(
      conversations
        .map((c) => c.application?.clipper_id)
        .filter((id) => id && id !== user.id)
    ),
  ];

  let profiles = [];
  if (counterpartIds.length > 0) {
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name, avatar_url")
      .in("id", counterpartIds);
    profiles = data ?? [];
  }
  const profileById = Object.fromEntries(profiles.map((p) => [p.id, p]));

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="mx-auto w-full max-w-3xl">
        <h1 className="text-2xl font-bold">Messages</h1>
        <p className="text-sm text-muted-foreground">
          One thread per application, so questions about a brief stay with it.
        </p>
      </div>

      <div className="mx-auto w-full max-w-3xl">
        {conversations.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <MessagesSquareIcon />
              </EmptyMedia>
              <EmptyTitle>No conversations yet</EmptyTitle>
              <EmptyDescription>
                A thread opens automatically when someone applies to a campaign.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="overflow-hidden rounded-lg border">
            {conversations.map((conversation) => {
              const other = profileById[conversation.application?.clipper_id];
              return (
                <li key={conversation.id} className="border-b last:border-b-0">
                  <Link
                    href={`/messages/${conversation.id}`}
                    className="flex items-center gap-3 p-4 hover:bg-muted"
                  >
                    <Avatar className="size-9">
                      <AvatarImage src={other?.avatar_url} alt={other?.full_name ?? ""} />
                      <AvatarFallback>
                        {(other?.full_name ?? "?").slice(0, 1).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {conversation.campaign?.title ?? "Campaign"}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {other?.full_name ?? "Creator"}
                      </p>
                    </div>
                    {conversation.last_message_at && (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatRelativeTime(conversation.last_message_at)}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
