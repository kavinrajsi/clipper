"use client"

import { usePathname } from "next/navigation"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { NotificationBell } from "@/components/notification-bell"

const PAGE_TITLES = {
  "/dashboard": "Dashboard",
  "/connectors": "Connectors",
  "/analytics": "Analytics",
  "/profile": "Profile",
  "/clipper-profile": "Clipper Profile",
  "/campaigns": "Campaigns",
  "/admin": "Admin",
  "/payout-account": "Payout Account",
  "/brand-profile": "Brand Profile",
  "/clippers": "Clippers",
  "/saved": "Saved",
  "/invitations": "Invitations",
  "/notifications": "Notifications",
  "/messages": "Messages",
  "/workspace/members": "Team",
  "/workspace/assets": "Brand assets",
  "/workspace": "Workspace",
}

function getPageTitle(pathname) {
  const prefix = Object.keys(PAGE_TITLES)
    .filter((path) => pathname.startsWith(path))
    .sort((a, b) => b.length - a.length)[0]
  return prefix ? PAGE_TITLES[prefix] : "Dashboard"
}

export function SiteHeader({ notifications = [], unreadCount = 0 }) {
  const pathname = usePathname()
  const title = getPageTitle(pathname)

  return (
    <header
      className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mx-2 h-4 data-vertical:self-auto" />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>{title}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="ml-auto">
          <NotificationBell
            initialNotifications={notifications}
            initialUnread={unreadCount}
          />
        </div>
      </div>
    </header>
  );
}
