"use client"

import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

function getInitials(name, email) {
  if (name) {
    return name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join("");
  }
  return email ? email[0].toUpperCase() : "?";
}

export function UserMenu({ user, profile }) {
  const router = useRouter()
  const supabase = createClient()
  const name =
    profile?.full_name || user.user_metadata?.full_name || user.user_metadata?.name || user.email

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push("/login")
    router.refresh()
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <Avatar>
          <AvatarImage
            src={profile?.avatar_url ?? user.user_metadata?.avatar_url}
            alt={name}
          />
          <AvatarFallback>{getInitials(profile?.full_name, user.email)}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{name}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => router.push("/dashboard")}>
            Dashboard
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => router.push("/profile")}>
            Profile
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => router.push("/connectors")}>
            Connectors
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleSignOut}>Sign out</DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
