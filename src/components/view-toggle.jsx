"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { LayoutGridIcon, TableIcon } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { VIEW_COOKIE, VIEW_COOKIE_MAX_AGE } from "@/lib/view-mode";

// Switches a list page between cards and a table.
//
// Writes both halves on every change: the URL so the view is shareable and the
// back button works (the pattern discover-filters.jsx sets), and a cookie so
// the choice survives arriving at the page with no query string. The cookie is
// written straight from the client the way sidebar.jsx does for sidebar_state
// — it is a display preference, not a credential, so it needs no API route.
//
// Calls useSearchParams, so every caller must wrap it in <Suspense>.
export function ViewToggle({ view }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function apply(next) {
    if (next === view) return;

    document.cookie = `${VIEW_COOKIE}=${next}; path=/; max-age=${VIEW_COOKIE_MAX_AGE}; samesite=lax`;

    // Built from the current params rather than replacing them, so anything
    // else on the query string survives the toggle.
    const search = new URLSearchParams(params);
    search.set("view", next);

    startTransition(() => {
      router.push(`${pathname}?${search}`, { scroll: false });
    });
  }

  return (
    <ToggleGroup
      // base-ui, not Radix: an array in, an array out — and it comes back
      // EMPTY when you click the item that is already active, which is what
      // the `?? view` guards against.
      value={[view]}
      onValueChange={(value) => apply(value[0] ?? view)}
      variant="outline"
      disabled={isPending}
      aria-label="View as"
    >
      <ToggleGroupItem value="card" aria-label="Card view">
        <LayoutGridIcon />
      </ToggleGroupItem>
      <ToggleGroupItem value="table" aria-label="Table view">
        <TableIcon />
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
