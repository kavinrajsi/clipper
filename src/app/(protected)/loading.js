import { Skeleton } from "@/components/ui/skeleton";

// The protected pages are a page title over either a card grid or a table, both
// inside the sidebar shell's p-6. A stat row plus rows covers both without
// pretending to know which one is coming.
export default function ProtectedLoading() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-2 h-4 w-72 max-w-full" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>

      <div className="flex flex-col gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}
