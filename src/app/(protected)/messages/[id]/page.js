import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatCampaignRate } from "@/lib/format";
import { ConversationThread } from "@/components/conversation-thread";
import { Button } from "@/components/ui/button";

export default async function ConversationPage({ params }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=/messages/${id}`);
  }

  // can_access_conversation makes an inaccessible thread indistinguishable from
  // one that doesn't exist, which is what we want.
  const { data: conversation } = await supabase
    .from("conversations")
    .select("*, application:campaign_applications(id, clipper_id), campaign:campaigns(id, title, payout_structure, payout_rate)")
    .eq("id", id)
    .maybeSingle();

  if (!conversation) notFound();

  const { data: messages } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", id)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  const senderIds = [
    ...new Set([...(messages ?? []).map((m) => m.sender_id), conversation.application?.clipper_id]),
  ].filter(Boolean);

  let profiles = [];
  if (senderIds.length > 0) {
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name, avatar_url")
      .in("id", senderIds);
    profiles = data ?? [];
  }
  const people = Object.fromEntries(profiles.map((p) => [p.id, p]));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b p-4">
        <Button
          variant="ghost"
          size="icon"
          nativeButton={false}
          render={<Link href="/messages" />}
          aria-label="Back to messages"
        >
          <ArrowLeftIcon />
        </Button>
        <div className="min-w-0">
          <p className="truncate font-medium">{conversation.campaign?.title ?? "Campaign"}</p>
          {conversation.campaign && (
            <p className="truncate text-xs text-muted-foreground">
              {formatCampaignRate(conversation.campaign)}
            </p>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          nativeButton={false}
          render={<Link href={`/campaigns/${conversation.campaign_id}`} />}
        >
          Campaign
        </Button>
      </div>

      <ConversationThread
        conversationId={conversation.id}
        initialMessages={messages ?? []}
        viewerId={user.id}
        people={people}
      />
    </div>
  );
}
