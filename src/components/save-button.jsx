"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BookmarkIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const CONFIG = {
  creator: { table: "saved_creators", column: "creator_id", noun: "Creator" },
  campaign: { table: "saved_campaigns", column: "campaign_id", noun: "Campaign" },
};

// Optimistic toggle: flip immediately, roll back and toast on failure. Saving
// is a low-stakes bookmark — waiting on a round trip to fill in an icon makes
// the whole directory feel slow.
export function SaveButton({
  type,
  targetId,
  initialSaved = false,
  isAuthenticated = true,
  signInHref,
  variant = "ghost",
  size = "icon",
  showLabel = false,
  className,
}) {
  const { table, column, noun } = CONFIG[type];
  const supabase = createClient();
  const router = useRouter();
  const [saved, setSaved] = useState(initialSaved);
  const [pending, setPending] = useState(false);

  // Anonymous visitors on a public profile get a real control that routes them
  // through sign-in and back, rather than a button that silently fails.
  if (!isAuthenticated) {
    return (
      <Button
        variant={variant}
        size={showLabel ? "sm" : size}
        nativeButton={false}
        className={className}
        render={<Link href={signInHref ?? "/login"} />}
        aria-label={`Save ${noun.toLowerCase()}`}
      >
        <BookmarkIcon />
        {showLabel && "Save"}
      </Button>
    );
  }

  async function toggle() {
    const next = !saved;
    setSaved(next);
    setPending(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setSaved(!next);
      setPending(false);
      toast.error("Sign in to save.");
      return;
    }

    const { error } = next
      ? await supabase.from(table).upsert({ user_id: user.id, [column]: targetId })
      : await supabase.from(table).delete().eq("user_id", user.id).eq(column, targetId);

    setPending(false);

    if (error) {
      setSaved(!next); // roll back
      toast.error(`Couldn't ${next ? "save" : "remove"} that. Try again.`);
      return;
    }

    toast.success(next ? `${noun} saved.` : `${noun} removed from saved.`);
    router.refresh();
  }

  return (
    <Button
      variant={variant}
      size={showLabel ? "sm" : size}
      onClick={toggle}
      disabled={pending}
      className={className}
      aria-pressed={saved}
      aria-label={saved ? `Remove saved ${noun.toLowerCase()}` : `Save ${noun.toLowerCase()}`}
    >
      <BookmarkIcon className={cn(saved && "fill-current")} />
      {showLabel && (saved ? "Saved" : "Save")}
    </Button>
  );
}
