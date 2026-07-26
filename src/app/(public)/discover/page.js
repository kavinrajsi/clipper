import { Suspense } from "react";
import { UsersRoundIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { ClipperDirectoryCard } from "@/components/clipper-directory-card";
import { DiscoverFilters } from "@/components/discover-filters";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata = {
  title: "Find short-form creators · Clipper",
  description:
    "Browse verified short-form video creators. Filter by category, availability and rate, and see performance backed by synced channel data.",
};

const PAGE_SIZE = 48;

function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

async function getCreators(searchParams) {
  const supabase = await createClient();

  const q = (searchParams.q ?? "").trim();
  const categories = toArray(searchParams.category);
  const availability = searchParams.availability;
  const sort = searchParams.sort ?? "views";

  // RLS ("Public profiles are readable by anyone") already limits this to
  // published rows; the explicit filter keeps the intent visible at the call
  // site rather than relying on a policy elsewhere.
  let query = supabase.from("clipper_profiles").select("*").eq("is_public", true);

  if (q) {
    // Simple substring matching. A tsvector column with a GIN index is the
    // upgrade path once the corpus is big enough for ranking to matter.
    const escaped = q.replace(/[%,()]/g, " ");
    query = query.or(
      `headline.ilike.%${escaped}%,bio.ilike.%${escaped}%,handle.ilike.%${escaped}%`
    );
  }
  if (categories.length > 0) query = query.overlaps("categories", categories);
  if (availability && availability !== "all") {
    query = query.eq("availability_status", availability);
  }

  if (sort === "recent") query = query.order("updated_at", { ascending: false });
  else if (sort === "rate_asc") {
    query = query.order("rate_amount", { ascending: true, nullsFirst: false });
  } else query = query.order("published_at", { ascending: false });

  const { data: profiles } = await query.limit(PAGE_SIZE);
  const rows = profiles ?? [];
  if (rows.length === 0) return [];

  const userIds = rows.map((row) => row.user_id);
  const [{ data: accounts }, { data: verifications }, { data: stats }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, avatar_url").in("id", userIds),
    supabase.from("creator_verification").select("*").in("user_id", userIds),
    supabase.from("creator_stats").select("*").in("user_id", userIds),
  ]);

  const accountById = Object.fromEntries((accounts ?? []).map((a) => [a.id, a]));
  const verificationById = Object.fromEntries((verifications ?? []).map((v) => [v.user_id, v]));
  const statsById = Object.fromEntries((stats ?? []).map((s) => [s.user_id, s]));

  const merged = rows.map((profile) => ({
    profile,
    account: accountById[profile.user_id],
    verification: verificationById[profile.user_id],
    stats: statsById[profile.user_id],
  }));

  // creator_stats is a view with no FK to clipper_profiles, so PostgREST can't
  // order by it. Sorting here is correct up to PAGE_SIZE; past that it would
  // need verified_views denormalised onto clipper_profiles and refreshed on
  // sync.
  if (sort === "views") {
    merged.sort((a, b) => Number(b.stats?.verified_views ?? 0) - Number(a.stats?.verified_views ?? 0));
  }

  return merged;
}

function ResultsSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-52 w-full rounded-xl" />
      ))}
    </div>
  );
}

async function Results({ searchParams }) {
  const creators = await getCreators(searchParams);

  if (creators.length === 0) {
    const filtered = Object.keys(searchParams).length > 0;
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <UsersRoundIcon />
          </EmptyMedia>
          <EmptyTitle>{filtered ? "No creators match those filters" : "No creators yet"}</EmptyTitle>
          <EmptyDescription>
            {filtered
              ? "Try removing a filter or searching for something broader."
              : "Creators appear here once they publish a profile."}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <>
      <p className="text-sm text-muted-foreground">
        {creators.length} creator{creators.length === 1 ? "" : "s"}
        {creators.length === PAGE_SIZE ? " (showing the first page)" : ""}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {creators.map(({ profile, account, verification, stats }) => (
          <ClipperDirectoryCard
            key={profile.user_id}
            clipperProfile={profile}
            profile={account}
            verification={verification}
            stats={stats}
          />
        ))}
      </div>
    </>
  );
}

export default async function DiscoverPage({ searchParams }) {
  const resolved = await searchParams;

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold">Find creators</h1>
          <p className="text-sm text-muted-foreground">
            Short-form editors with performance backed by synced channel data.
          </p>
        </div>

        {/* useSearchParams needs a Suspense boundary to avoid opting the whole
            route into client-side rendering. */}
        <Suspense fallback={<Skeleton className="h-24 w-full rounded-lg" />}>
          <DiscoverFilters />
        </Suspense>

        {/* Keyed so changing filters re-suspends and shows the skeleton rather
            than silently holding stale results. */}
        <Suspense key={JSON.stringify(resolved)} fallback={<ResultsSkeleton />}>
          <Results searchParams={resolved} />
        </Suspense>
      </div>
    </div>
  );
}
