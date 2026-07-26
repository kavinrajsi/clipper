import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceRole } from "@/lib/workspaces";

const INVITABLE_ROLES = ["admin", "member", "billing"];

// Resolving an email to a user requires auth.admin.listUsers(), so this cannot
// be done client-side — profiles has no email column.
export async function POST(request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { workspaceId, email, role = "member" } = await request.json();

  if (!workspaceId || !email) {
    return NextResponse.json({ error: "Workspace and email are required." }, { status: 400 });
  }
  if (!INVITABLE_ROLES.includes(role)) {
    return NextResponse.json({ error: "Unknown role." }, { status: 400 });
  }

  // Only owners and admins may invite. Checked on the RLS-scoped client first,
  // before anything touches the service-role client.
  const callerRole = await getWorkspaceRole(supabase, user, workspaceId);
  if (!callerRole || !["owner", "admin"].includes(callerRole)) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const normalised = String(email).trim().toLowerCase();
  const admin = createAdminClient();

  // listUsers is paginated and has no email filter, so this walks pages. Fine
  // at current scale; swap for an indexed lookup if the user table grows.
  let existing = null;
  for (let page = 1; page <= 10 && !existing; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) break;
    existing = (data?.users ?? []).find((u) => u.email?.toLowerCase() === normalised) ?? null;
    if ((data?.users ?? []).length < 200) break;
  }

  if (existing) {
    if (existing.id === user.id) {
      return NextResponse.json({ error: "You're already in this workspace." }, { status: 400 });
    }

    // Re-inviting someone who is already here is a no-op, not an error.
    const { data: already } = await admin
      .from("workspace_members")
      .select("user_id, accepted_at")
      .eq("workspace_id", workspaceId)
      .eq("user_id", existing.id)
      .maybeSingle();

    if (already) {
      return NextResponse.json({
        ok: true,
        status: already.accepted_at ? "already_member" : "already_invited",
      });
    }

    const { error: insertError } = await admin.from("workspace_members").insert({
      workspace_id: workspaceId,
      user_id: existing.id,
      role,
      invited_by: user.id,
      accepted_at: null,
    });

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true, status: "invited_existing" });
  }

  // No account yet — the invite waits, and tg_claim_workspace_invites attaches
  // it when they sign up.
  //
  // Not an upsert: the unique index is on (workspace_id, lower(email)) and is
  // partial (claimed_at is null), which PostgREST cannot target as a conflict
  // constraint. Check, then insert or refresh.
  const { data: pending } = await admin
    .from("workspace_invites")
    .select("id")
    .eq("workspace_id", workspaceId)
    .ilike("email", normalised)
    .is("claimed_at", null)
    .maybeSingle();

  // Re-inviting refreshes the expiry rather than erroring or clearing it —
  // expires_at is NOT NULL.
  const freshExpiry = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

  const { error: inviteError } = pending
    ? await admin
        .from("workspace_invites")
        .update({ role, invited_by: user.id, expires_at: freshExpiry })
        .eq("id", pending.id)
    : await admin
        .from("workspace_invites")
        .insert({ workspace_id: workspaceId, email: normalised, role, invited_by: user.id });

  if (inviteError) {
    return NextResponse.json({ error: inviteError.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, status: "invited_pending_signup" });
}
