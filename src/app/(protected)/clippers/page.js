import { redirect } from "next/navigation";
import { isSuperAdmin } from "@/lib/admin";
import { requireRole } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { ClipperDirectoryCard } from "@/components/clipper-directory-card";

export default async function ClippersPage() {
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

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Clippers</h1>
        <p className="text-sm text-muted-foreground">
          Browse clipper profiles to find the right fit for your campaign.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(clipperProfiles ?? []).map((clipperProfile) => (
          <ClipperDirectoryCard
            key={clipperProfile.user_id}
            clipperProfile={clipperProfile}
            profile={profileById[clipperProfile.user_id]}
          />
        ))}
        {(clipperProfiles ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">No clipper profiles yet.</p>
        )}
      </div>
    </div>
  );
}
