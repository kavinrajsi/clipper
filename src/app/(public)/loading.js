import { Skeleton } from "@/components/ui/skeleton";

// The card grid matches ResultsSkeleton in discover/page.js — same h-52 tile,
// same two-column grid — so streaming from this shell into that one does not
// change the layout under the reader.
export default function PublicLoading() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="mx-auto w-full max-w-3xl">
        <Skeleton className="h-8 w-52" />
        <Skeleton className="mt-2 h-4 w-80 max-w-full" />
      </div>
      <div className="mx-auto w-full max-w-3xl">
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-52 w-full rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  );
}
