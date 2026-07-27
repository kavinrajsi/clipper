import { redirect } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { isSuperAdmin } from "@/lib/admin";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getActiveWorkspace, getUserWorkspaces } from "@/lib/workspaces";

export default async function ProtectedLayout({ children }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const cookieStore = await cookies();
  const [workspaces, activeWorkspace] = await Promise.all([
    getUserWorkspaces(supabase, user),
    getActiveWorkspace(supabase, user, cookieStore),
  ]);

  const [{ data: profile }, { data: notifications }, { count: unreadCount }] = await Promise.all([
    supabase.from("profiles").select("full_name, avatar_url, role").eq("id", user.id).single(),
    supabase
      .from("notifications")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(10),
    // head:true fetches the count without the rows — this runs on every
    // protected page load.
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("read_at", null),
  ]);

  return (
    <SidebarProvider
      style={{
        "--sidebar-width": "calc(var(--spacing) * 72)",
        "--header-height": "calc(var(--spacing) * 12)",
      }}
    >
      <AppSidebar
        user={user}
        profile={profile}
        isAdmin={isSuperAdmin(user)}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspace?.id}
      />
      <SidebarInset>
        <SiteHeader
          notifications={notifications ?? []}
          unreadCount={unreadCount ?? 0}
        />
        <div className="flex flex-1 flex-col">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
