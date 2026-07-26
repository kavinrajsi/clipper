// Workspace access checks for route handlers and Server Components.
//
// RLS enforces MEMBERSHIP — a non-member's queries return nothing. Role gating
// for money is enforced here instead, because the payout-release path uses the
// service-role client and bypasses RLS entirely, so a policy could not gate it.
//
// Mirrors requireRole() in src/lib/roles.js: pass an already-created client and
// an already-fetched user, get a boolean or a thrown redirect.

// Roles permitted to move money: fund a campaign, release a payout.
export const MONEY_ROLES = ["owner", "admin", "billing"];

// Roles permitted to run a campaign day to day.
export const CAMPAIGN_ROLES = ["owner", "admin", "member"];

/**
 * The caller's role in a workspace, or null if they are not an accepted member.
 * Reads through the RLS-scoped client — workspace_members is readable by
 * co-members, and a pending invite (accepted_at null) is treated as no access.
 */
export async function getWorkspaceRole(supabase, user, workspaceId) {
  if (!user || !workspaceId) return null;

  const { data } = await supabase
    .from("workspace_members")
    .select("role, accepted_at")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!data || !data.accepted_at) return null;
  return data.role;
}

/**
 * Resolve a campaign's workspace and the caller's role in it, in one round trip.
 * Returns null when the campaign does not exist or RLS hides it.
 */
export async function getCampaignAccess(supabase, user, campaignId) {
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", campaignId)
    .maybeSingle();

  if (!campaign) return null;

  const role = await getWorkspaceRole(supabase, user, campaign.workspace_id);
  return { campaign, role };
}

/**
 * Gate a campaign action on workspace membership, optionally on specific roles.
 * Returns { campaign, role } on success, or null — callers decide whether that
 * is a 404, a 403, or a redirect, so this stays usable from both routes and
 * pages.
 *
 *   const access = await requireCampaignAccess(supabase, user, id, MONEY_ROLES);
 *   if (!access) return NextResponse.json({ error: "..." }, { status: 404 });
 */
export async function requireCampaignAccess(supabase, user, campaignId, roles = null) {
  const access = await getCampaignAccess(supabase, user, campaignId);
  if (!access || !access.role) return null;
  if (roles && !roles.includes(access.role)) return null;
  return access;
}

/**
 * The workspaces a user belongs to, most recent first. One per brand today;
 * the switcher in the team UI reads this.
 */
export async function getUserWorkspaces(supabase, user) {
  if (!user) return [];

  const { data } = await supabase
    .from("workspace_members")
    .select("role, accepted_at, workspace:workspaces(*)")
    .eq("user_id", user.id)
    .not("accepted_at", "is", null);

  return (data ?? [])
    .filter((row) => row.workspace)
    .map((row) => ({ ...row.workspace, role: row.role }));
}

// Name of the cookie holding the workspace the user last switched to.
export const ACTIVE_WORKSPACE_COOKIE = "active_workspace";

/**
 * The workspace to act in.
 *
 * The cookie is a hint, never an authority: whatever it says is checked against
 * actual membership, and anything unrecognised falls back to the first
 * workspace. A client claiming to be in a workspace it does not belong to gets
 * its own workspace, not that one.
 */
export async function getActiveWorkspace(supabase, user, cookieStore = null) {
  const workspaces = await getUserWorkspaces(supabase, user);
  if (workspaces.length === 0) return null;

  const requested = cookieStore?.get(ACTIVE_WORKSPACE_COOKIE)?.value;
  if (requested) {
    const match = workspaces.find((w) => w.id === requested);
    if (match) return match;
  }

  return workspaces[0];
}

/**
 * Pending workspace memberships — invited, not yet accepted. Readable by the
 * invitee because workspace_members' select policy covers their own row.
 */
export async function getPendingWorkspaceInvites(supabase, user) {
  if (!user) return [];

  const { data } = await supabase
    .from("workspace_members")
    .select("workspace_id, role, created_at, workspace:workspaces(id, name)")
    .eq("user_id", user.id)
    .is("accepted_at", null);

  return (data ?? []).filter((row) => row.workspace);
}
