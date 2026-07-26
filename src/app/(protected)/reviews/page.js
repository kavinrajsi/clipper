import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { ReviewForm } from "@/components/review-form";
import { StarRating } from "@/components/star-rating";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";

export const metadata = {
  title: "Reviews",
};

// A review needs a released payout, so the payout is what this page is really
// listing: every engagement where money actually moved, on either side of it.
//
// The payout rows a user can see are already scoped by campaign_payouts' own
// policies — a clipper sees their own, a brand sees their workspace's — so the
// two directions fall out of one query rather than needing a role branch.
async function getEngagements(supabase, userId) {
  const { data: payouts } = await supabase
    .from("campaign_payouts")
    .select(
      `id, clipper_id, released_at, application_id,
       application:campaign_applications!inner(
         id, clipper_id,
         campaign:campaigns!inner(id, title, brand_id)
       )`,
    )
    .eq("status", "released")
    .order("released_at", { ascending: false });

  const rows = payouts ?? [];
  if (rows.length === 0) return [];

  const applicationIds = rows.map((p) => p.application_id);

  // Reviews the viewer has already written. Their own unpublished rows are
  // visible to them under the select policy, which is what makes "already
  // reviewed" accurate before publication.
  const { data: mine } = await supabase
    .from("reviews")
    .select("application_id, direction, rating, is_published")
    .eq("author_id", userId)
    .in("application_id", applicationIds);

  const written = new Map((mine ?? []).map((r) => [`${r.application_id}:${r.direction}`, r]));

  // Names for whoever sits on the other side.
  const counterpartIds = [
    ...new Set(
      rows.flatMap((p) => [p.application.clipper_id, p.application.campaign.brand_id]),
    ),
  ];
  const { data: people } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", counterpartIds);
  const names = new Map((people ?? []).map((p) => [p.id, p.full_name]));

  return rows.map((payout) => {
    const isClipper = payout.application.clipper_id === userId;
    const direction = isClipper ? "clipper_to_brand" : "brand_to_clipper";
    const subjectId = isClipper
      ? payout.application.campaign.brand_id
      : payout.application.clipper_id;

    return {
      payoutId: payout.id,
      applicationId: payout.application_id,
      campaignTitle: payout.application.campaign.title,
      releasedAt: payout.released_at,
      direction,
      subjectId,
      subjectName: names.get(subjectId) ?? "them",
      existing: written.get(`${payout.application_id}:${direction}`) ?? null,
    };
  });
}

export default async function ReviewsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/reviews");
  }

  const [engagements, { data: received }] = await Promise.all([
    getEngagements(supabase, user.id),
    supabase
      .from("reviews")
      .select("*")
      .eq("subject_id", user.id)
      .eq("is_published", true)
      .order("published_at", { ascending: false }),
  ]);

  const toWrite = engagements.filter((e) => !e.existing);
  const waiting = engagements.filter((e) => e.existing && !e.existing.is_published);

  return (
    <div className="flex flex-1 flex-col gap-8 p-6">
      <div className="mx-auto w-full max-w-3xl">
        <h1 className="text-2xl font-bold">Reviews</h1>
        <p className="text-sm text-muted-foreground">
          You can review anyone you&apos;ve completed a paid campaign with. Both
          reviews stay hidden until you&apos;ve both submitted.
        </p>
      </div>

      <section className="mx-auto w-full max-w-3xl">
        <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
          Waiting on you
        </h2>
        {toWrite.length === 0 ? (
          <Empty className="mt-4">
            <EmptyHeader>
              <EmptyTitle>Nothing to review</EmptyTitle>
              <EmptyDescription>
                Once a campaign payout is released, the engagement shows up here
                for 14 days.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {toWrite.map((e) => (
              <li
                key={e.payoutId}
                className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border p-4"
              >
                <div>
                  <p className="font-medium">{e.subjectName}</p>
                  <p className="text-sm text-muted-foreground">
                    {e.campaignTitle} · paid {formatDate(e.releasedAt, { style: "medium" })}
                  </p>
                </div>
                <ReviewForm
                  applicationId={e.applicationId}
                  direction={e.direction}
                  subjectId={e.subjectId}
                  subjectName={e.subjectName}
                  campaignTitle={e.campaignTitle}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {waiting.length > 0 && (
        <section className="mx-auto w-full max-w-3xl">
          <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
            Submitted, not yet public
          </h2>
          <ul className="mt-4 flex flex-col gap-3">
            {waiting.map((e) => (
              <li
                key={e.payoutId}
                className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border p-4"
              >
                <div>
                  <p className="font-medium">{e.subjectName}</p>
                  <p className="text-sm text-muted-foreground">{e.campaignTitle}</p>
                </div>
                <div className="flex items-center gap-3">
                  <StarRating value={e.existing.rating} size="sm" />
                  <Badge variant="secondary">Waiting on them</Badge>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mx-auto w-full max-w-3xl">
        <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
          About you
        </h2>
        {(received ?? []).length === 0 ? (
          <Empty className="mt-4">
            <EmptyHeader>
              <EmptyTitle>No reviews yet</EmptyTitle>
              <EmptyDescription>
                Reviews written about you appear here once both sides have
                submitted.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {(received ?? []).map((review) => (
              <li key={review.id} className="rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <StarRating value={review.rating} size="sm" />
                  <span className="text-sm text-muted-foreground">
                    {formatDate(review.published_at, { style: "medium" })}
                  </span>
                </div>
                {review.body && <p className="mt-2 text-sm leading-6">{review.body}</p>}
                <p className="mt-2 text-sm text-muted-foreground">
                  — {review.author_name ?? "A Clipper user"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
