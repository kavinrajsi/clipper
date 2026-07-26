import { StarIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const SIZES = {
  sm: "size-3.5",
  md: "size-4",
  lg: "size-5",
};

// Display only — the input lives in review-form.jsx.
//
// `value` may be null: a creator with reviews but fewer than three has a count
// and no average (creator_stats suppresses it), and that is a deliberate state,
// not missing data.
export function StarRating({ value, count, size = "md", className }) {
  const rounded = value == null ? 0 : Math.round(value);

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span className="inline-flex items-center gap-0.5" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((star) => (
          <StarIcon
            key={star}
            className={cn(
              SIZES[size],
              star <= rounded
                ? "fill-[oklch(0.63_0.24_25)] text-[oklch(0.63_0.24_25)]"
                : "text-muted-foreground/40",
            )}
          />
        ))}
      </span>
      <span className="text-sm tabular-nums">
        {value != null && <span className="font-medium">{value}</span>}
        {count != null && (
          <span className="text-muted-foreground">
            {value != null ? " " : ""}({count})
          </span>
        )}
      </span>
      <span className="sr-only">
        {value != null
          ? `Rated ${value} out of 5 from ${count} reviews`
          : `${count ?? 0} reviews, not enough for an average yet`}
      </span>
    </span>
  );
}

// The profile's headline rating. Below three reviews creator_stats returns a
// null average on purpose, so this shows the count alone; with none at all it
// says so plainly rather than rendering an empty row of stars.
export function RatingSummary({ stats, className }) {
  const count = stats?.review_count ?? 0;

  if (count === 0) {
    return (
      <span className={cn("text-sm text-muted-foreground", className)}>
        New to Clipper
      </span>
    );
  }

  return <StarRating value={stats.avg_rating} count={count} className={className} />;
}
