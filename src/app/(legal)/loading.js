import { Skeleton } from "@/components/ui/skeleton";

// Prose: a title, then paragraph blocks of uneven width. Even ragged right
// edges read as text far better than uniform bars do.
export default function LegalLoading() {
  return (
    <div className="flex flex-col gap-8">
      <Skeleton className="h-9 w-56" />
      {Array.from({ length: 4 }).map((_, block) => (
        <div key={block} className="flex flex-col gap-3">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
        </div>
      ))}
    </div>
  );
}
