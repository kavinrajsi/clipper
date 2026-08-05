"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

// The escape hatch for a role picked wrongly at signup. Users cannot change
// their own — guard_profile_role refuses any caller with an auth.uid() — so
// this posts to the admin route, which does it on the service-role client.
//
// Two-step rather than a confirm() dialog, which would block the page.
export function AdminRoleAction({ userId, currentRole, onDone }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  const target = currentRole === "brand" ? "clipper" : "brand";

  async function change() {
    setSaving(true);
    const response = await fetch(`/api/admin/users/${userId}/role`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: target }),
    });
    setSaving(false);
    setConfirming(false);

    if (!response.ok) {
      const { error } = await response.json().catch(() => ({}));
      toast.error(error ?? "Couldn't change the role.");
      return;
    }

    toast.success(`Now a ${target}.`);
    onDone?.();
    router.refresh();
  }

  if (!confirming) {
    return (
      <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
        Change to {target}
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        {target === "brand"
          ? "They'll get a workspace and the brand side of the app."
          : "Their workspace, members and campaigns stay behind — nothing is cleaned up."}
      </p>
      <div className="flex gap-2">
        <Button variant="destructive" size="sm" onClick={change} disabled={saving}>
          {saving && <Spinner />}
          Yes, make them a {target}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
