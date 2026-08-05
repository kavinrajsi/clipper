import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Logo } from "@/components/logo";
import { RolePicker } from "@/components/role-picker";

// Deliberately NOT under (protected): that layout is what redirects here, so a
// page inside it would loop. With no route group it inherits the root layout,
// which is what a sidebar-less page wants — app-sidebar branches its entire nav
// on role, and this is the one user who hasn't got one yet.
export default async function OnboardingRolePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/onboarding/role");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, role_chosen_at")
    .eq("id", user.id)
    .single();

  // Already chosen. Without this the back button re-renders a form that can
  // only fail, since the trigger refuses the second write.
  if (profile?.role_chosen_at) {
    redirect(profile.role === "brand" ? "/campaigns" : "/dashboard");
  }

  return (
    <div className="flex min-h-svh flex-col gap-4 p-6 md:p-10">
      <div className="flex justify-center gap-2 md:justify-start">
        <Link href="/" className="flex items-center gap-2 font-medium">
          <div className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Logo className="size-4" />
          </div>
          Clipper
        </Link>
      </div>
      <div className="flex flex-1 items-center justify-center">
        <div className="w-full max-w-2xl">
          <RolePicker userId={user.id} />
        </div>
      </div>
    </div>
  );
}
