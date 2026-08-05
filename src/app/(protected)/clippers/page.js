import { Suspense } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { UsersRoundIcon } from "lucide-react";
import { isSuperAdmin } from "@/lib/admin";
import { requireRole } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { resolveView } from "@/lib/view-mode";
import { ClipperDirectoryCard } from "@/components/clipper-directory-card";
import { ClipperDirectoryTable } from "@/components/clipper-directory-table";
import { ViewToggle } from "@/components/view-toggle";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

export default async function ClippersPage({ searchParams }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/clippers");
  }

  if (!isSuperAdmin(user)) {
    await requireRole(supabase, user, "brand", "/dashboard");
  }

  const { data: clipperProfiles } = await supabase
    .from("clipper_profiles")
    .select("*")
    .order("updated_at", { ascending: false });

  const clipperIds = (clipperProfiles ?? []).map((clipperProfile) => clipperProfile.user_id);

  let profiles = [];
  if (clipperIds.length > 0) {
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name, avatar_url")
      .in("id", clipperIds);
    profiles = data ?? [];
  }

  const profileById = Object.fromEntries(profiles.map((profile) => [profile.id, profile]));

  const [params, cookieStore] = await Promise.all([searchParams, cookies()]);
  const view = resolveView(params?.view, cookieStore);

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Clippers</h1>
          <p className="text-sm text-muted-foreground">
            Browse clipper profiles to find the right fit for your campaign.
          </p>
        </div>
        <Suspense fallback={null}>
          <ViewToggle view={view} />
        </Suspense>
      </div>
      {/* An empty screen is an invitation to act, so the zero-result state
          points at /discover — the public directory has creators this
          brand-scoped list does not. */}
      {(clipperProfiles ?? []).length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UsersRoundIcon />
            </EmptyMedia>
            <EmptyTitle>No clipper profiles yet</EmptyTitle>
            <EmptyDescription>
              Clippers appear here once they fill in a profile. In the meantime,
              browse everyone who has published one.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button nativeButton={false} render={<Link href="/discover" />}>
              Find creators
            </Button>
          </EmptyContent>
        </Empty>
      ) : view === "table" ? (
        <ClipperDirectoryTable
          creators={clipperProfiles.map((clipperProfile) => ({
            clipperProfile,
            profile: profileById[clipperProfile.user_id],
          }))}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {clipperProfiles.map((clipperProfile) => (
            <ClipperDirectoryCard
              key={clipperProfile.user_id}
              clipperProfile={clipperProfile}
              profile={profileById[clipperProfile.user_id]}
            />
          ))}
        </div>
      )}
    </div>
  );
}
