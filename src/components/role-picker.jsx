"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ClapperboardIcon, MegaphoneIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

const OPTIONS = [
  {
    value: "clipper",
    title: "I'm a clipper",
    description: "Browse campaigns, submit clips from your YouTube channel, and get paid.",
    icon: ClapperboardIcon,
  },
  {
    value: "brand",
    title: "I'm a brand",
    description: "Post campaigns, fund them, and approve the clips creators send you.",
    icon: MegaphoneIcon,
  },
];

export function RolePicker({ userId }) {
  const router = useRouter();
  // No default. The bug this whole flow fixes is a silent default that nobody
  // was ever shown, so an unmade choice has to look unmade.
  const [role, setRole] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (!role || saving) return;

    setSaving(true);
    setError(null);

    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("profiles")
      .update({
        role,
        role_chosen_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);

    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }

    // Route on what was just picked, not on any inherited ?next — a proxy-set
    // next=/dashboard handed to someone who chose brand lands on a clipper page
    // and gets bounced straight back out by requireRole.
    router.replace(role === "brand" ? "/campaigns" : "/dashboard");
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">How will you use Clipper?</h1>
        <p className="text-sm text-muted-foreground">
          This sets up your account and decides what you see. You can&apos;t change it later —
          you&apos;d need to contact support.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2" role="radiogroup" aria-label="Account type">
        {OPTIONS.map((option) => {
          const Icon = option.icon;
          const selected = role === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setRole(option.value)}
              className={cn(
                "flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                selected && "border-primary bg-muted ring-2 ring-primary"
              )}
            >
              <Icon className="size-5" aria-hidden />
              <span className="font-medium">{option.title}</span>
              <span className="text-sm text-muted-foreground">{option.description}</span>
            </button>
          );
        })}
      </div>

      <Button type="submit" disabled={!role || saving} className="self-start">
        {saving && <Spinner />}
        Continue
      </Button>
    </form>
  );
}
