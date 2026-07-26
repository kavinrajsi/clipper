import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatClipperRate, formatDate, formatNumber } from "@/lib/format";
import { FollowButton } from "@/components/follow-button";
import { ReviewList } from "@/components/review-list";
import { SaveButton } from "@/components/save-button";
import { RatingSummary } from "@/components/star-rating";
import { VerifiedBadge } from "@/components/verified-badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

const AVAILABILITY = {
  available: { label: "Available for work", variant: "default" },
  busy: { label: "Busy", variant: "secondary" },
  unavailable: { label: "Not taking work", variant: "outline" },
};

function initials(name) {
  if (!name) return "C";
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

// Reads go through the RLS-scoped client. The "Public profiles are readable by
// anyone" policy limits this to is_public = true, so an unpublished handle is
// indistinguishable from a nonexistent one — which is what we want.
async function getProfile(handle) {
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("clipper_profiles")
    .select("*")
    .ilike("handle", handle)
    .eq("is_public", true)
    .maybeSingle();

  if (!profile) return null;

  const [
    { data: account },
    { data: verification },
    { data: stats },
    { data: portfolio },
    { data: reviews },
  ] = await Promise.all([
    supabase.from("profiles").select("full_name, avatar_url").eq("id", profile.user_id).maybeSingle(),
    supabase.from("creator_verification").select("*").eq("user_id", profile.user_id).maybeSingle(),
    supabase.from("creator_stats").select("*").eq("user_id", profile.user_id).maybeSingle(),
    supabase
      .from("portfolio_items")
      .select("*")
      .eq("user_id", profile.user_id)
      .order("position", { ascending: true }),
    // Only brand-to-clipper reviews belong on a creator profile. The select
    // policy already hides anything unpublished from anyone but its author, so
    // this needs no is_published filter of its own — and must not have one, or
    // it would drop reviews the 14-day window released.
    supabase
      .from("reviews")
      .select("*")
      .eq("subject_id", profile.user_id)
      .eq("direction", "brand_to_clipper")
      .order("created_at", { ascending: false }),
  ]);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let saved = false;
  let following = false;
  if (user && user.id !== profile.user_id) {
    const [{ data: savedRow }, { data: followRow }] = await Promise.all([
      supabase
        .from("saved_creators")
        .select("creator_id")
        .eq("user_id", user.id)
        .eq("creator_id", profile.user_id)
        .maybeSingle(),
      supabase
        .from("follows")
        .select("following_id")
        .eq("follower_id", user.id)
        .eq("following_id", profile.user_id)
        .maybeSingle(),
    ]);
    saved = Boolean(savedRow);
    following = Boolean(followRow);
  }

  // The select policy also returns the viewer's OWN unpublished review, which is
  // right for /reviews and wrong here — it would put a row on the page that
  // creator_stats deliberately excludes from the count. Apply the view's
  // predicate so the list and the aggregate always agree.
  const windowOpensAt = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const publicReviews = (reviews ?? []).filter(
    (r) => r.is_published || new Date(r.created_at).getTime() < windowOpensAt,
  );

  return {
    profile,
    account,
    verification,
    stats,
    portfolio: portfolio ?? [],
    reviews: publicReviews,
    saved,
    following,
    viewer: user,
  };
}

export async function generateMetadata({ params }) {
  const { handle } = await params;
  const data = await getProfile(handle);
  if (!data) return { title: "Profile not available · Clipper" };

  const name = data.account?.full_name ?? `@${data.profile.handle}`;
  return {
    title: `${name} · Clipper`,
    description: data.profile.headline ?? data.profile.bio ?? undefined,
    openGraph: {
      title: `${name} · Clipper`,
      description: data.profile.headline ?? data.profile.bio ?? undefined,
      images: data.account?.avatar_url ? [data.account.avatar_url] : undefined,
    },
  };
}

export default async function CreatorProfilePage({ params }) {
  const { handle } = await params;
  const data = await getProfile(handle);

  // Unpublished and nonexistent both land here by design.
  if (!data) notFound();

  const { profile, account, verification, stats, portfolio, reviews, saved, following, viewer } =
    data;
  const isSelf = viewer?.id === profile.user_id;
  const name = account?.full_name ?? `@${profile.handle}`;
  const rate = formatClipperRate(profile);
  const availability = AVAILABILITY[profile.availability_status];

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="mx-auto w-full max-w-3xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <Avatar className="size-20 rounded-lg">
            <AvatarImage src={account?.avatar_url} alt={name} />
            <AvatarFallback className="rounded-lg text-lg">{initials(name)}</AvatarFallback>
          </Avatar>

          <div className="flex flex-1 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold">{name}</h1>
              <VerifiedBadge verification={verification} />
            </div>

            {profile.headline && <p className="text-muted-foreground">{profile.headline}</p>}

            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              {profile.location && <span>{profile.location}</span>}
              {profile.languages?.length > 0 && (
                <>
                  {profile.location && <span aria-hidden>·</span>}
                  <span>{profile.languages.join(", ")}</span>
                </>
              )}
              {availability && (
                <Badge variant={availability.variant}>{availability.label}</Badge>
              )}
            </div>

            <RatingSummary stats={stats} />
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {!isSelf && (
              <FollowButton
                creatorId={profile.user_id}
                initialFollowing={following}
                isAuthenticated={Boolean(viewer)}
                signInHref={`/login?next=${encodeURIComponent(`/c/${profile.handle}`)}`}
              />
            )}
            {!isSelf && (
              <SaveButton
                type="creator"
                targetId={profile.user_id}
                initialSaved={saved}
                isAuthenticated={Boolean(viewer)}
                signInHref={`/login?next=${encodeURIComponent(`/c/${profile.handle}`)}`}
                variant="outline"
                showLabel
              />
            )}
            <Button nativeButton={false} render={<Link href="/campaigns" />}>
              Invite to campaign
            </Button>
          </div>
        </div>

        {/* Verified performance is the differentiator — it comes from OAuth-synced
            YouTube data, not self-reporting. Omitted entirely when there is
            nothing synced, rather than shown as a row of zeroes. */}
        {stats && stats.videos_synced > 0 && (
          <Card className="mt-6">
            <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <div>
                <p className="text-sm text-muted-foreground">Verified views</p>
                <p className="text-2xl font-semibold tabular-nums">
                  {formatNumber(stats.verified_views)}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Clips</p>
                <p className="text-2xl font-semibold tabular-nums">
                  {formatNumber(stats.videos_synced)}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Campaigns</p>
                <p className="text-2xl font-semibold tabular-nums">
                  {formatNumber(stats.completed_campaigns)}
                </p>
              </div>
              {verification?.last_synced_at && (
                <p className="col-span-full text-xs text-muted-foreground">
                  Synced {formatDate(verification.last_synced_at, { style: "medium" })}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {profile.bio && (
          <>
            <Separator className="my-6" />
            <h2 className="text-lg font-semibold">About</h2>
            <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{profile.bio}</p>
          </>
        )}

        {portfolio.length > 0 && (
          <>
            <Separator className="my-6" />
            <h2 className="text-lg font-semibold">Work</h2>
            <div className="mt-3 grid gap-4 sm:grid-cols-3">
              {portfolio.map((item) => (
                <a
                  key={item.id}
                  href={item.video_url ?? "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex flex-col gap-2"
                >
                  {item.thumbnail_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.thumbnail_url}
                      alt={item.title ?? "Clip"}
                      className="aspect-video w-full rounded-md object-cover transition-opacity group-hover:opacity-90"
                    />
                  )}
                  <span className="line-clamp-2 text-sm font-medium">{item.title}</span>
                  {item.view_count != null && (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {formatNumber(item.view_count)} views
                    </span>
                  )}
                </a>
              ))}
            </div>
          </>
        )}

        <Separator className="my-6" />
        <div className="grid gap-4 sm:grid-cols-2">
          {rate && (
            <div>
              <p className="text-sm text-muted-foreground">Rate</p>
              <p className="text-sm font-medium">{rate}</p>
            </div>
          )}
          {profile.categories?.length > 0 && (
            <div>
              <p className="text-sm text-muted-foreground">Categories</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {profile.categories.map((c) => (
                  <Badge key={c} variant="secondary">
                    {c}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {profile.style_tags?.length > 0 && (
            <div>
              <p className="text-sm text-muted-foreground">Style</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {profile.style_tags.map((t) => (
                  <Badge key={t} variant="outline">
                    {t}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>

        <Separator className="my-6" />
        <h2 className="text-lg font-semibold">
          Reviews{reviews.length > 0 && ` (${reviews.length})`}
        </h2>
        <div className="mt-4">
          <ReviewList reviews={reviews} stats={stats} />
        </div>
      </div>
    </div>
  );
}
