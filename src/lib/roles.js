import { redirect } from "next/navigation";

export async function requireRole(supabase, user, role, redirectTo) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if ((profile?.role ?? "clipper") !== role) {
    redirect(redirectTo);
  }
}
