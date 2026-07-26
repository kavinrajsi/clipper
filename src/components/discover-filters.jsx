"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { SearchIcon, XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";

export const CATEGORIES = ["Gaming", "Comedy", "Sports", "Music", "Tech", "IRL", "Educational"];

export const SORTS = [
  { value: "views", label: "Most verified views" },
  { value: "recent", label: "Recently active" },
  { value: "rate_asc", label: "Lowest rate" },
];

const AVAILABILITY = [
  { value: "all", label: "Any availability" },
  { value: "available", label: "Available now" },
];

// State lives in the URL, not in React. That keeps results shareable, makes the
// back button work, and lets the page stay a Server Component.
export function DiscoverFilters() {
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const urlQuery = params.get("q") ?? "";
  const [query, setQuery] = useState(urlQuery);
  const [lastUrlQuery, setLastUrlQuery] = useState(urlQuery);
  const activeCategories = params.getAll("category");

  // Resync the input when navigation changes the URL — back button, or the
  // Clear button — without fighting the user while they type. This is React's
  // "adjust state during render" pattern rather than an effect, which would
  // render once with stale text and then again with the correct value.
  if (urlQuery !== lastUrlQuery) {
    setLastUrlQuery(urlQuery);
    setQuery(urlQuery);
  }

  function push(next) {
    startTransition(() => {
      router.push(next.toString() ? `/discover?${next}` : "/discover", { scroll: false });
    });
  }

  function setParam(key, value) {
    const next = new URLSearchParams(params);
    if (!value || value === "all") next.delete(key);
    else next.set(key, value);
    push(next);
  }

  function toggleCategory(category) {
    const next = new URLSearchParams(params);
    const current = next.getAll("category");
    next.delete("category");
    const updated = current.includes(category)
      ? current.filter((c) => c !== category)
      : [...current, category];
    updated.forEach((c) => next.append("category", c));
    push(next);
  }

  function onSearch(event) {
    event.preventDefault();
    const next = new URLSearchParams(params);
    if (query.trim()) next.set("q", query.trim());
    else next.delete("q");
    push(next);
  }

  const hasFilters = [...params.keys()].length > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row">
        <form onSubmit={onSearch} className="flex flex-1 gap-2">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name, headline, or bio"
            aria-label="Search creators"
          />
          <Button type="submit" variant="outline" aria-label="Search">
            {isPending ? <Spinner /> : <SearchIcon />}
          </Button>
        </form>

        <Select
          value={params.get("availability") ?? "all"}
          onValueChange={(value) => setParam("availability", value)}
        >
          <SelectTrigger className="sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AVAILABILITY.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={params.get("sort") ?? "views"}
          onValueChange={(value) => setParam("sort", value)}
        >
          <SelectTrigger className="sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORTS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {CATEGORIES.map((category) => {
          const active = activeCategories.includes(category);
          return (
            <button key={category} type="button" onClick={() => toggleCategory(category)}>
              <Badge
                variant={active ? "default" : "outline"}
                className="cursor-pointer hover:bg-muted"
              >
                {category}
              </Badge>
            </button>
          );
        })}
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => push(new URLSearchParams())}
            className="text-muted-foreground"
          >
            <XIcon />
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}
