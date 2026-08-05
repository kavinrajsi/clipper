import { redirect } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { NotificationProvider } from "@/components/notification-provider";
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

  const [{ data: profile }, { data: notifications }, { count: unreadCount }, { data: prefs }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("full_name, avatar_url, role, role_chosen_at")
        .eq("id", user.id)
        .single(),
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
      // maybeSingle, not single: this row only exists once the user has
      // touched the sound switch, so for almost everyone there is nothing
      // here and single() would error.
      supabase
        .from("notification_preferences")
        .select("sound_enabled")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);

  // Clipper or brand is picked once and then locked, so nothing in here can
  // render until it has been: the sidebar, /campaigns and every requireRole
  // gate branch on a role this user has not chosen yet. The picker lives
  // outside this layout so this redirect cannot loop.
  if (!profile?.role_chosen_at) {
    redirect("/onboarding/role");
  }

  return (
    <SidebarProvider
      style={{
        "--sidebar-width": "calc(var(--spacing) * 72)",
        "--header-height": "calc(var(--spacing) * 12)",
      }}
    >
      {/* Wraps both the sidebar and the header: they render the same unread
          count and it has to stay one number. */}
      <NotificationProvider
        userId={user.id}
        initialNotifications={notifications ?? []}
        initialUnread={unreadCount ?? 0}
        initialSoundEnabled={prefs?.sound_enabled ?? true}
      >
        <AppSidebar
          user={user}
          profile={profile}
          isAdmin={isSuperAdmin(user)}
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspace?.id}
        />
        <SidebarInset>
          <SiteHeader />
          <div className="flex flex-1 flex-col">{children}</div>
        </SidebarInset>
      </NotificationProvider>
    </SidebarProvider>
  );
}
