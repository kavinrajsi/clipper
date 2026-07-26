"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

// hiddenBelowSm: this row has no mobile menu, so only "Find creators" survives
// at 390px — the home page and footer link the other two there.
const NAV = [
  { label: "Find creators", href: "/discover", hiddenBelowSm: false },
  { label: "For brands", href: "/for-brands", hiddenBelowSm: true },
  { label: "For clippers", href: "/for-clippers", hiddenBelowSm: true },
]

export function HeaderNav() {
  const pathname = usePathname()

  return (
    <nav aria-label="Main" className="flex items-center gap-6">
      {NAV.map(({ label, href, hiddenBelowSm }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`)
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-sm text-sm whitespace-nowrap underline-offset-8 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring",
              hiddenBelowSm && "hidden sm:inline",
              active
                ? "font-medium text-foreground underline decoration-2"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </Link>
        )
      })}
    </nav>
  );
}
