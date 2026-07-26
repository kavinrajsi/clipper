"use client"

import * as React from "react"
import Link from "next/link"

import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import { Logo } from "@/components/logo"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import {
  LayoutDashboardIcon,
  LinkIcon,
  BarChart3Icon,
  ClapperboardIcon,
  MegaphoneIcon,
  WalletIcon,
  Building2Icon,
  UsersIcon,
  ShieldIcon,
  BookmarkIcon,
  MailOpenIcon,
  StarIcon,
  UsersRoundIcon,
} from "lucide-react"

const clipperNavMain = [
  {
    title: "Dashboard",
    url: "/dashboard",
    icon: <LayoutDashboardIcon />,
  },
  {
    title: "Connectors",
    url: "/connectors",
    icon: <LinkIcon />,
  },
  {
    title: "Analytics",
    url: "/analytics",
    icon: <BarChart3Icon />,
  },
  {
    title: "Clipper Profile",
    url: "/clipper-profile",
    icon: <ClapperboardIcon />,
  },
  {
    title: "Campaigns",
    url: "/campaigns",
    icon: <MegaphoneIcon />,
  },
  {
    title: "Invitations",
    url: "/invitations",
    icon: <MailOpenIcon />,
  },
  {
    title: "Saved",
    url: "/saved",
    icon: <BookmarkIcon />,
  },
  {
    title: "Reviews",
    url: "/reviews",
    icon: <StarIcon />,
  },
  {
    title: "Payout Account",
    url: "/payout-account",
    icon: <WalletIcon />,
  },
]

const brandNavMain = [
  {
    title: "Campaigns",
    url: "/campaigns",
    icon: <MegaphoneIcon />,
  },
  {
    title: "Clippers",
    url: "/clippers",
    icon: <UsersIcon />,
  },
  {
    title: "Saved",
    url: "/saved",
    icon: <BookmarkIcon />,
  },
  {
    title: "Reviews",
    url: "/reviews",
    icon: <StarIcon />,
  },
  {
    title: "Brand Profile",
    url: "/brand-profile",
    icon: <Building2Icon />,
  },
  {
    title: "Team",
    url: "/workspace/members",
    icon: <UsersRoundIcon />,
  },
]

export function AppSidebar({ user, profile, isAdmin, ...props }) {
  const { isMobile, setOpenMobile } = useSidebar()
  const isBrand = profile?.role === "brand"
  const baseNavMain = isBrand ? brandNavMain : clipperNavMain
  const navMain = isAdmin
    ? [...baseNavMain, { title: "Admin", url: "/admin", icon: <ShieldIcon /> }]
    : baseNavMain
  const homeUrl = isBrand ? "/campaigns" : "/dashboard"

  return (
    <Sidebar variant="inset" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="data-[slot=sidebar-menu-button]:p-1.5!"
              onClick={() => isMobile && setOpenMobile(false)}
              render={<Link href={homeUrl} />}>
              <Logo className="size-5!" />
              <span className="text-base font-semibold">Clipper</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navMain} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} profile={profile} />
      </SidebarFooter>
    </Sidebar>
  );
}
