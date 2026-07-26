"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export function InvitationActions({ invite }) {
  const supabase = createClient();
  const router = useRouter();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  async function respond(decision) {
    setError(null);
    setBusy(decision);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setBusy(null);
      setError("Sign in again to respond to this invite.");
      return;
    }

    if (decision === "declined") {
      const { error: updateError } = await supabase
        .from("campaign_invites")
        .update({ status: "declined", responded_at: new Date().toISOString() })
        .eq("id", invite.id);
      setBusy(null);
      if (updateError) {
        setError(updateError.message);
        return;
      }
      toast.success("Invite declined.");
      router.refresh();
      return;
    }

    // Accepting creates the application first. If that fails there is nothing
    // to roll back, and the invite stays actionable.
    const { error: applyError } = await supabase.from("campaign_applications").insert({
      campaign_id: invite.campaign_id,
      clipper_id: user.id,
      message: null,
    });

    if (applyError) {
      setBusy(null);
      // The INSERT policy requires the campaign to be active and funded. That
      // is the common failure here, and the raw Postgres error explains none
      // of it.
      const message = applyError.message ?? "";
      if (applyError.code === "42501" || message.includes("row-level security")) {
        setError(
          "This campaign isn't open for applications yet — the brand still needs to fund it. The invite stays valid."
        );
      } else if (applyError.code === "23505") {
        setError("You've already applied to this campaign.");
      } else {
        setError(message);
      }
      return;
    }

    const { error: updateError } = await supabase
      .from("campaign_invites")
      .update({ status: "accepted", responded_at: new Date().toISOString() })
      .eq("id", invite.id);

    setBusy(null);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    toast.success("Invite accepted — your application is in.");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex gap-2">
        <Button size="sm" disabled={Boolean(busy)} onClick={() => respond("accepted")}>
          {busy === "accepted" && <Spinner />}
          Accept
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={Boolean(busy)}
          onClick={() => respond("declined")}
        >
          {busy === "declined" && <Spinner />}
          Decline
        </Button>
      </div>
    </div>
  );
}
