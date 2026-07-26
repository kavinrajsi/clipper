import Link from "next/link"
import { HeaderNav } from "@/components/header-nav"
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
    // Rule spans the viewport; the contents sit in the same max-w-4xl column as
    // every page body and the footer. Three tracks so the nav is centred on that
    // column, not on whatever space the wordmark and account control leave.
    <header className="border-b px-6">
      <div className="mx-auto grid w-full max-w-4xl grid-cols-[1fr_auto_1fr] items-center gap-4 py-4">
        <Link
          href="/"
          className="flex items-center gap-2 justify-self-start rounded-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
        >
          <Logo className="size-5" />
          Clipper
        </Link>
        <HeaderNav />
        <div className="justify-self-end">
          {user ? (
            <UserMenu user={user} profile={profile} />
          ) : (
            <Button nativeButton={false} render={<Link href="/login" />}>
              Sign in
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
