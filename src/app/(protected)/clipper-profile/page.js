import Link from "next/link";
import { redirect } from "next/navigation";
import { isSuperAdmin } from "@/lib/admin";
import { requireRole } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { ClipperProfileForm } from "@/components/clipper-profile-form";
import { PortfolioManager } from "@/components/portfolio-manager";

export default async function ClipperProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/clipper-profile");
  }

  if (!isSuperAdmin(user)) {
    await requireRole(supabase, user, "clipper", "/campaigns");
  }

  const [{ data: clipperProfile }, { data: portfolioItems }, { data: syncedVideos }] =
    await Promise.all([
      supabase.from("clipper_profiles").select("*").eq("user_id", user.id).single(),
      supabase
        .from("portfolio_items")
        .select("*")
        .eq("user_id", user.id)
        .order("position", { ascending: true }),
      // Candidates for the picker — the connector already syncs these.
      supabase
        .from("youtube_videos")
        .select("video_id, title, thumbnail_url, view_count, published_at")
        .eq("user_id", user.id)
        .order("published_at", { ascending: false })
        .limit(50),
    ]);

  const items = portfolioItems ?? [];

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="mx-auto w-full max-w-3xl">
        <h1 className="text-2xl font-bold">Clipper Profile</h1>
        <p className="text-sm text-muted-foreground">
          Details brands see when evaluating you for a campaign. By completing this profile,
          you agree to the{" "}
          <Link href="/clipper-terms" className="underline underline-offset-4">
            Clipper Terms
          </Link>
          .
        </p>
        {clipperProfile?.is_public && clipperProfile?.handle && (
          <p className="mt-2 text-sm">
            Live at{" "}
            <Link
              href={`/c/${clipperProfile.handle}`}
              className="font-medium underline underline-offset-4"
            >
              /c/{clipperProfile.handle}
            </Link>
          </p>
        )}
      </div>
      <ClipperProfileForm
        userId={user.id}
        clipperProfile={clipperProfile}
        portfolioCount={items.length}
        className="mx-auto w-full max-w-3xl"
      />
      <PortfolioManager
        userId={user.id}
        items={items}
        syncedVideos={syncedVideos ?? []}
        className="mx-auto w-full max-w-3xl"
      />
    </div>
  );
}
