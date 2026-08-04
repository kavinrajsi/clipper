"use client"

import * as React from "react"
import Link from "next/link"

import { NavMain } from "@/components/nav-main"
import { WorkspaceSwitcher } from "@/components/workspace-switcher"
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
  MessagesSquareIcon,
  UsersRoundIcon,
  PaperclipIcon,
  FilmIcon,
  SettingsIcon,
  BellIcon,
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
    title: "Messages",
    url: "/messages",
    icon: <MessagesSquareIcon />,
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
    title: "Messages",
    url: "/messages",
    icon: <MessagesSquareIcon />,
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
    title: "Studio",
    url: "/studio",
    icon: <FilmIcon />,
  },
  {
    title: "Brand assets",
    url: "/workspace/assets",
    icon: <PaperclipIcon />,
  },
  {
    title: "Team",
    url: "/workspace/members",
    icon: <UsersRoundIcon />,
  },
  {
    title: "Workspace",
    url: "/workspace/settings",
    icon: <SettingsIcon />,
  },
]

export function AppSidebar({
  user,
  profile,
  isAdmin,
  workspaces = [],
  activeWorkspaceId,
  unreadCount = 0,
  ...props
}) {
  const { isMobile, setOpenMobile } = useSidebar()
  const isBrand = profile?.role === "brand"
  const baseNavMain = isBrand ? brandNavMain : clipperNavMain
  // Built here rather than in the arrays above because the badge is per-render
  // and those are module-level constants.
  const notificationsItem = {
    title: "Notifications",
    url: "/notifications",
    icon: <BellIcon />,
    // Same convention as the header bell, so the two counts never disagree.
    badge: unreadCount > 0 ? (unreadCount > 9 ? "9+" : unreadCount) : null,
  }
  const navMain = isAdmin
    ? [...baseNavMain, notificationsItem, { title: "Admin", url: "/admin", icon: <ShieldIcon /> }]
    : [...baseNavMain, notificationsItem]
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
        {/* Only renders when there is more than one workspace to switch to. */}
        <WorkspaceSwitcher workspaces={workspaces} activeId={activeWorkspaceId} />
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
