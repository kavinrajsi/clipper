import Link from "next/link"
import { Logo } from "@/components/logo"
import { createClient } from "@/lib/supabase/server"
import { Button } from "@/components/ui/button"
import { UserMenu } from "@/components/user-menu"

export async function Header() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  let profile = null
  if (user) {
    const { data } = await supabase
      .from("profiles")
      .select("full_name, avatar_url")
      .eq("id", user.id)
      .single()
    profile = data
  }

  return (
    <header className="flex items-center justify-between border-b px-6 py-4">
      <div className="flex items-center gap-6">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <Logo className="size-5" />
          Clipper
        </Link>
        <Link
          href="/discover"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Find creators
        </Link>
      </div>
      {user ? (
        <UserMenu user={user} profile={profile} />
      ) : (
        <div className="flex items-center gap-2">
          <Button nativeButton={false} render={<Link href="/login" />}>
            Sign in
          </Button>
        </div>
      )}
    </header>
  );
}
