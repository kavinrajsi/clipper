"use client";

import { useId, useState } from "react";
import { toast } from "sonner";
import { Volume2Icon, VolumeXIcon } from "lucide-react";
import { useNotifications } from "@/components/notification-provider";
import { playNotificationSound } from "@/lib/notification-sound";
import { createClient } from "@/lib/supabase/client";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

// Lives here rather than in the bell dropdown: that dropdown calls
// markAllRead() from onOpenChange, and a control inside DropdownMenuContent
// needs base-ui-specific handling to not close the menu on click.
export function NotificationSoundToggle() {
  const { soundEnabled, setSoundEnabled } = useNotifications();
  const [saving, setSaving] = useState(false);
  const id = useId();

  async function toggle(next) {
    if (saving) return;
    setSaving(true);
    setSoundEnabled(next);

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setSoundEnabled(!next);
      setSaving(false);
      return;
    }

    // upsert, not update: nothing has ever written to this table, so for most
    // users there is no row and an update would affect nothing while the
    // switch sat there looking saved. updated_at has a default but no bump
    // trigger, so it has to be set explicitly or it freezes at first insert.
    const { error } = await supabase.from("notification_preferences").upsert(
      {
        user_id: user.id,
        sound_enabled: next,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

    setSaving(false);

    if (error) {
      setSoundEnabled(!next);
      toast.error("Couldn't save that. Try again.");
      return;
    }

    // Turning it on is the one moment the user has just clicked, so the
    // autoplay policy will let the sound through — play it as the confirmation
    // that it works.
    if (next) playNotificationSound();
  }

  return (
    <div className="flex items-center gap-2">
      {soundEnabled ? (
        <Volume2Icon className="size-4 text-muted-foreground" aria-hidden />
      ) : (
        <VolumeXIcon className="size-4 text-muted-foreground" aria-hidden />
      )}
      <Label htmlFor={id} className="text-sm font-normal text-muted-foreground">
        Sound
      </Label>
      <Switch
        id={id}
        checked={soundEnabled}
        onCheckedChange={toggle}
        disabled={saving}
        aria-label="Play a sound for new notifications"
      />
    </div>
  );
}
