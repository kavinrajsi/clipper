"use client"

import * as React from "react"
import Link from "next/link"

import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
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
  CommandIcon,
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
    title: "Brand Profile",
    url: "/brand-profile",
    icon: <Building2Icon />,
  },
]

export function AppSidebar({ user, profile, isAdmin, ...props }) {
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
              render={<Link href={homeUrl} />}>
              <CommandIcon className="size-5!" />
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
