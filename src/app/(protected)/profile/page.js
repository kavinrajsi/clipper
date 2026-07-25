import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProfileForm } from "@/components/profile-form";

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/profile");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, avatar_url, role")
    .eq("id", user.id)
    .single();

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Profile</h1>
        <p className="text-sm text-muted-foreground">
          Update your name and avatar.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Need help?{" "}
          <Link href="/faq" className="underline underline-offset-4">
            FAQ
          </Link>{" "}
          ·{" "}
          <Link href="/support" className="underline underline-offset-4">
            Support
          </Link>
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <ProfileForm user={user} profile={profile} />
      </div>
    </div>
  );
}
