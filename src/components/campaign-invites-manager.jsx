"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { SendIcon, UserPlusIcon, XIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/format";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

const STATUS_VARIANT = {
  sent: "secondary",
  viewed: "secondary",
  accepted: "default",
  declined: "destructive",
  expired: "outline",
};

function initials(name) {
  if (!name) return "?";
  return name.split(" ").filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join("");
}

export function CampaignInvitesManager({ campaign, invites, candidates }) {
  const supabase = createClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(null);

  const invitedIds = new Set(invites.map((i) => i.clipper_id));
  const available = candidates.filter((c) => !invitedIds.has(c.user_id));

  async function invite(candidate) {
    setError(null);
    setBusyId(candidate.user_id);

    const { error: insertError } = await supabase.from("campaign_invites").insert({
      campaign_id: campaign.id,
      clipper_id: candidate.user_id,
      invited_by: campaign.brand_id,
      message: message || null,
    });

    setBusyId(null);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    toast.success("Invite sent.");
    setMessage("");
    setOpen(false);
    router.refresh();
  }

  async function rescind(invite) {
    setError(null);
    setBusyId(invite.id);
    const { error: deleteError } = await supabase
      .from("campaign_invites")
      .delete()
      .eq("id", invite.id);
    setBusyId(null);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    toast.success("Invite rescinded.");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {campaign.visibility === "public" && (
        <Alert>
          <AlertDescription>
            This campaign is visible to everyone. You can still invite specific creators — set it
            to invite-only if you want it unlisted.
          </AlertDescription>
        </Alert>
      )}

      {invites.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UserPlusIcon />
            </EmptyMedia>
            <EmptyTitle>No invites yet</EmptyTitle>
            <EmptyDescription>
              Invite creators directly instead of waiting for applications. Creators you&apos;ve
              saved appear first.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {invites.map((invite) => (
            <li
              key={invite.id}
              className="flex items-center gap-3 rounded-md border p-3"
            >
              <Avatar className="size-8">
                <AvatarImage src={invite.avatar_url} alt={invite.full_name ?? "Creator"} />
                <AvatarFallback>{initials(invite.full_name)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {invite.handle ? (
                    <Link href={`/c/${invite.handle}`} className="hover:underline">
                      {invite.full_name ?? `@${invite.handle}`}
                    </Link>
                  ) : (
                    (invite.full_name ?? "Creator")
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  Invited {formatDate(invite.created_at, { style: "medium" })}
                  {invite.status === "sent" &&
                    ` · expires ${formatDate(invite.expires_at, { style: "medium" })}`}
                </p>
              </div>
              <Badge variant={STATUS_VARIANT[invite.status] ?? "outline"}>{invite.status}</Badge>
              {/* Only un-responded invites can be pulled back. Once a creator
                  has accepted there is an application to manage instead. */}
              {["sent", "viewed"].includes(invite.status) && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Rescind invite"
                  disabled={busyId === invite.id}
                  onClick={() => rescind(invite)}
                >
                  {busyId === invite.id ? <Spinner /> : <XIcon />}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger
            render={<Button size="sm" disabled={available.length === 0} />}
          >
            <UserPlusIcon />
            Invite creators
          </DialogTrigger>
          <DialogContent className="max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Invite creators</DialogTitle>
              <DialogDescription>
                Saved creators first, then others with a published profile.
              </DialogDescription>
            </DialogHeader>

            <Textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Optional note — why you're reaching out to them specifically."
              rows={3}
            />

            <div className="flex flex-col gap-1">
              {available.map((candidate) => (
                <button
                  key={candidate.user_id}
                  type="button"
                  onClick={() => invite(candidate)}
                  disabled={busyId === candidate.user_id}
                  className="flex items-center gap-3 rounded-md p-2 text-left hover:bg-muted disabled:opacity-60"
                >
                  <Avatar className="size-8">
                    <AvatarImage src={candidate.avatar_url} alt={candidate.full_name ?? ""} />
                    <AvatarFallback>{initials(candidate.full_name)}</AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {candidate.full_name ?? `@${candidate.handle}`}
                    </span>
                    {candidate.headline && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {candidate.headline}
                      </span>
                    )}
                  </span>
                  {candidate.saved && <Badge variant="outline">Saved</Badge>}
                  {busyId === candidate.user_id ? <Spinner /> : <SendIcon className="size-4" />}
                </button>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
