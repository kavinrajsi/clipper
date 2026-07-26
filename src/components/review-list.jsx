import { formatDate } from "@/lib/format";
import { StarRating } from "@/components/star-rating";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";

// Every review here passed the released-payout gate in the insert policy, so
// "Verified hire" is a statement about money that moved, not a self-declared
// badge. That is the whole reason the gate is in the database.
function ReviewRow({ review }) {
  return (
    <li className="border-t border-border py-5 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-3">
        <StarRating value={review.rating} size="sm" />
        <Badge variant="secondary">Verified hire</Badge>
        <span className="text-sm text-muted-foreground">
          {formatDate(review.published_at ?? review.created_at, { style: "medium" })}
        </span>
      </div>

      {review.body && <p className="mt-3 text-sm leading-6">{review.body}</p>}

      <p className="mt-2 text-sm text-muted-foreground">
        — {review.author_name ?? "A brand on Clipper"}
      </p>
    </li>
  );
}

function Distribution({ reviews }) {
  const total = reviews.length;
  const buckets = [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: reviews.filter((r) => r.rating === star).length,
  }));

  return (
    <div className="flex flex-col gap-2">
      {buckets.map(({ star, count }) => (
        <div key={star} className="flex items-center gap-3">
          <span className="w-3 text-sm tabular-nums text-muted-foreground">{star}</span>
          {/* className lands on Progress's root, which is the flex wrapper —
              the bar's own height comes from ProgressTrack. */}
          <Progress value={total === 0 ? 0 : (count / total) * 100} className="flex-1" />
          <span className="w-6 text-right text-sm tabular-nums text-muted-foreground">
            {count}
          </span>
        </div>
      ))}
    </div>
  );
}

export function ReviewList({ reviews, stats }) {
  if (!reviews || reviews.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No reviews yet</EmptyTitle>
          <EmptyDescription>
            Reviews appear here after a campaign payout is released, so they
            always follow real work.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
        <div className="sm:w-40">
          {stats?.avg_rating != null ? (
            <>
              <p className="text-3xl font-semibold tabular-nums">{stats.avg_rating}</p>
              <StarRating value={stats.avg_rating} size="sm" />
            </>
          ) : (
            // Fewer than three reviews: creator_stats withholds the average, and
            // so does this. Showing "5.0 from 1 review" would be false precision.
            <p className="text-sm text-muted-foreground">
              Too few reviews for an average yet.
            </p>
          )}
          <p className="mt-1 text-sm text-muted-foreground">
            {reviews.length} review{reviews.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex-1">
          <Distribution reviews={reviews} />
        </div>
      </div>

      <ul>
        {reviews.map((review) => (
          <ReviewRow key={review.id} review={review} />
        ))}
      </ul>
    </div>
  );
}
