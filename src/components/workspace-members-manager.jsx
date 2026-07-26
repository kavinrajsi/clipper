"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MailIcon, UserPlusIcon, XIcon } from "lucide-react";
import { formatDate } from "@/lib/format";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";

const ROLE_LABEL = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  billing: "Billing",
};

const ROLE_HELP = {
  owner: "Everything, including deleting the workspace.",
  admin: "Everything except deleting the workspace.",
  member: "Runs campaigns and reviews work. Cannot move money.",
  billing: "Funds campaigns and releases payouts.",
};

const INVITABLE = ["admin", "member", "billing"];

function initials(name, email) {
  const source = name || email || "?";
  return source.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join("");
}

export function WorkspaceMembersManager({ workspace, members, invites, viewerId, viewerRole }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [busyId, setBusyId] = useState(null);
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState(null);

  const canManage = ["owner", "admin"].includes(viewerRole);
  const ownerCount = members.filter((m) => m.role === "owner" && m.accepted_at).length;

  async function invite(event) {
    event.preventDefault();
    setError(null);
    setInviting(true);

    const response = await fetch("/api/workspace/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: workspace.id, email, role: inviteRole }),
    });
    const result = await response.json().catch(() => null);
    setInviting(false);

    if (!response.ok) {
      setError(result?.error ?? "Couldn't send that invite.");
      return;
    }

    setEmail("");
    toast.success(
      result?.status === "invited_pending_signup"
        ? "Invited. They'll join once they sign up — you'll need to tell them."
        : result?.status === "already_member"
          ? "They're already in this workspace."
          : "Invite sent."
    );
    router.refresh();
  }

  async function changeRole(member, role) {
    setError(null);
    setBusyId(member.user_id);

    const response = await fetch(`/api/workspace/members/${member.user_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: workspace.id, role }),
    });
    const result = await response.json().catch(() => null);
    setBusyId(null);

    if (!response.ok) {
      setError(result?.error ?? "Couldn't change that role.");
      return;
    }
    toast.success("Role updated.");
    router.refresh();
  }

  async function remove(member) {
    setError(null);
    setBusyId(member.user_id);

    const response = await fetch(
      `/api/workspace/members/${member.user_id}?workspaceId=${workspace.id}`,
      { method: "DELETE" }
    );
    const result = await response.json().catch(() => null);
    setBusyId(null);

    if (!response.ok) {
      setError(result?.error ?? "Couldn't remove them.");
      return;
    }
    toast.success(member.user_id === viewerId ? "You left the workspace." : "Member removed.");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-2">
        {members.map((member) => {
          const isSelf = member.user_id === viewerId;
          // The last owner cannot be demoted or removed — also enforced by a
          // database trigger, so this is a nicer message rather than the
          // protection itself.
          const isLastOwner = member.role === "owner" && ownerCount <= 1;

          return (
            <div
              key={member.user_id}
              className="flex flex-wrap items-center gap-3 rounded-lg border p-3"
            >
              <Avatar className="size-9">
                <AvatarImage src={member.avatar_url} alt={member.full_name ?? ""} />
                <AvatarFallback>{initials(member.full_name, member.email)}</AvatarFallback>
              </Avatar>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {member.full_name ?? member.email ?? "Member"}
                  {isSelf && <span className="text-muted-foreground"> (you)</span>}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {member.accepted_at
                    ? `Joined ${formatDate(member.accepted_at, { style: "medium" })}`
                    : "Invited — hasn't accepted yet"}
                </p>
              </div>

              {!member.accepted_at && <Badge variant="secondary">Pending</Badge>}

              {canManage && !isSelf ? (
                <Select
                  value={member.role}
                  onValueChange={(role) => changeRole(member, role)}
                  disabled={busyId === member.user_id || isLastOwner}
                >
                  <SelectTrigger size="sm" className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.keys(ROLE_LABEL)
                      .filter((r) => r !== "owner" || viewerRole === "owner")
                      .map((r) => (
                        <SelectItem key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              ) : (
                <Badge variant="outline">{ROLE_LABEL[member.role]}</Badge>
              )}

              {(canManage || isSelf) && !isLastOwner && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={isSelf ? "Leave workspace" : "Remove member"}
                  disabled={busyId === member.user_id}
                  onClick={() => remove(member)}
                >
                  {busyId === member.user_id ? <Spinner /> : <XIcon />}
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {invites.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">Waiting for signup</h2>
          {invites.map((invite) => (
            <div key={invite.id} className="flex items-center gap-3 rounded-lg border border-dashed p-3">
              <MailIcon className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{invite.email}</p>
                <p className="text-xs text-muted-foreground">
                  Joins as {ROLE_LABEL[invite.role]} · expires{" "}
                  {formatDate(invite.expires_at, { style: "medium" })}
                </p>
              </div>
              <Badge variant="outline">No account yet</Badge>
            </div>
          ))}
        </div>
      )}

      {canManage && (
        <form onSubmit={invite} className="flex flex-col gap-3 rounded-lg border p-4">
          <Field>
            <FieldLabel htmlFor="invite-email">Invite someone</FieldLabel>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="invite-email"
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="teammate@company.com"
                className="flex-1"
              />
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger className="sm:w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INVITABLE.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="submit" disabled={inviting}>
                {inviting ? <Spinner /> : <UserPlusIcon />}
                Invite
              </Button>
            </div>
            <FieldDescription>
              {ROLE_HELP[inviteRole]} We don&apos;t send invite emails yet, so let them know
              yourself.
            </FieldDescription>
          </Field>
        </form>
      )}
    </div>
  );
}
