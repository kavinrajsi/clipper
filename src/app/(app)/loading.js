import { Skeleton } from "@/components/ui/skeleton";

// Mirrors the marketing pages: a two-line display headline, a line of body
// copy, a CTA row, then a band of cards. Shaped like the real thing so the page
// does not jump when it arrives.
export default function AppLoading() {
  return (
    <div className="flex flex-1 flex-col">
      <section className="border-b border-border px-6 py-14 sm:py-20">
        <div className="mx-auto grid max-w-4xl items-start gap-x-10 gap-y-8 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="flex w-full flex-col gap-3 lg:col-span-2">
            <Skeleton className="h-11 w-full max-w-2xl" />
            <Skeleton className="h-11 w-full max-w-xl" />
          </div>
          <div className="flex flex-col gap-5">
            <Skeleton className="h-6 w-80 max-w-full" />
            <Skeleton className="h-11 w-40" />
          </div>
          <Skeleton className="h-40 w-full rounded-lg" />
        </div>
      </section>

      <section className="px-6 py-16">
        <div className="mx-auto max-w-4xl">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-3 h-8 w-72 max-w-full" />
          <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-40 w-full rounded-lg" />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
