"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { UserCheckIcon, UserPlusIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

// A follow is a subscription, distinct from a save: saving is a private
// bookmark, following opts you into notifications about that creator's work.
// It shipped with notifications rather than with saves because until there was
// something to deliver it would have been a control that did nothing.
export function FollowButton({
  creatorId,
  initialFollowing = false,
  isAuthenticated = true,
  signInHref,
}) {
  const supabase = createClient();
  const router = useRouter();
  const [following, setFollowing] = useState(initialFollowing);
  const [pending, setPending] = useState(false);

  if (!isAuthenticated) {
    return (
      <Button
        variant="outline"
        size="sm"
        nativeButton={false}
        render={<Link href={signInHref ?? "/login"} />}
      >
        <UserPlusIcon />
        Follow
      </Button>
    );
  }

  async function toggle() {
    const next = !following;
    setFollowing(next);
    setPending(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setFollowing(!next);
      setPending(false);
      toast.error("Sign in to follow.");
      return;
    }

    const { error } = next
      ? await supabase.from("follows").upsert({ follower_id: user.id, following_id: creatorId })
      : await supabase
          .from("follows")
          .delete()
          .eq("follower_id", user.id)
          .eq("following_id", creatorId);

    setPending(false);
    if (error) {
      setFollowing(!next);
      toast.error(`Couldn't ${next ? "follow" : "unfollow"}. Try again.`);
      return;
    }

    toast.success(next ? "Following." : "Unfollowed.");
    router.refresh();
  }

  return (
    <Button
      variant={following ? "secondary" : "outline"}
      size="sm"
      onClick={toggle}
      disabled={pending}
      aria-pressed={following}
    >
      {following ? <UserCheckIcon /> : <UserPlusIcon />}
      {following ? "Following" : "Follow"}
    </Button>
  );
}
