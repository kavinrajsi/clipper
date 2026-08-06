import { redirect } from "next/navigation";
import { isSuperAdmin } from "@/lib/admin";

// The caller's business role, or null when there is no user. Returns rather
// than redirects, so route handlers can use it too — same split as
// getWorkspaceRole/requireCampaignAccess in src/lib/workspaces.js, and for the
// same reason: a redirect is not an answer a fetch() can act on.
export async function getAppRole(supabase, user) {
  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  return data?.role ?? "clipper";
}

// Super admin is a separate axis from role (src/lib/admin.js), and the pages
// that gate on role already bypass it ad hoc. Centralising it here keeps the
// page guard and the route guard from drifting apart.
export async function hasAppRole(supabase, user, role) {
  if (isSuperAdmin(user)) return true;
  return (await getAppRole(supabase, user)) === role;
}

export async function requireRole(supabase, user, role, redirectTo) {
  if (!(await hasAppRole(supabase, user, role))) {
    redirect(redirectTo);
  }
}
