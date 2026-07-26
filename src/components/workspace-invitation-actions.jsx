"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

// Accepting stamps accepted_at, which is what every workspace helper checks.
// Until then the row exists but grants nothing, so nobody is silently added to
// an organisation.
export function WorkspaceInvitationActions({ workspaceId }) {
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
      setError("Sign in again to respond.");
      return;
    }

    const { error: writeError } =
      decision === "accept"
        ? await supabase
            .from("workspace_members")
            .update({ accepted_at: new Date().toISOString() })
            .eq("workspace_id", workspaceId)
            .eq("user_id", user.id)
        : await supabase
            .from("workspace_members")
            .delete()
            .eq("workspace_id", workspaceId)
            .eq("user_id", user.id);

    setBusy(null);
    if (writeError) {
      setError(writeError.message);
      return;
    }

    toast.success(decision === "accept" ? "You've joined the workspace." : "Invitation declined.");
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
        <Button size="sm" disabled={Boolean(busy)} onClick={() => respond("accept")}>
          {busy === "accept" && <Spinner />}
          Join workspace
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={Boolean(busy)}
          onClick={() => respond("decline")}
        >
          {busy === "decline" && <Spinner />}
          Decline
        </Button>
      </div>
    </div>
  );
}
