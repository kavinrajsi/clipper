import Link from "next/link";
import { Logo } from "@/components/logo";

// The columns are the site's own split — a visitor is here as a brand or as a
// clipper, and everything else is help. Grouping by audience rather than by
// "Product / Company / Legal" means the footer answers the same question the
// rest of the page does.
const COLUMNS = [
  {
    heading: "For brands",
    links: [
      ["How it works", "/for-brands"],
      ["Post a campaign", "/login"],
    ],
  },
  {
    heading: "For clippers",
    links: [
      ["How it works", "/for-clippers"],
      ["Find creators", "/discover"],
    ],
  },
  {
    heading: "Help",
    links: [
      ["FAQ", "/faq"],
      ["Support", "/support"],
    ],
  },
];

const LEGAL = [
  ["Terms", "/terms"],
  ["Privacy", "/privacy"],
  ["Clipper terms", "/clipper-terms"],
];

const linkClass =
  "rounded-sm text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring";

export function Footer() {
  return (
    <footer className="px-6 py-12">
      <div className="mx-auto max-w-4xl">
        {/* The hero opens a timeline bracket; this closes it. Doubles as the
            footer's top rule — one divider, not two. */}
        <div className="flex items-center gap-2" aria-hidden="true">
          <span className="h-px flex-1 bg-border" />
          <span className="font-mono text-xs text-[oklch(0.63_0.24_25)]">]</span>
        </div>

        <div className="mt-10 grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
            >
              <Logo className="size-5" />
              Clipper
            </Link>
            <p className="mt-3 max-w-xs text-sm text-muted-foreground">
              Brands post the campaign. Clippers cut the footage, publish it to
              their own channel, and get paid on the campaign&apos;s terms.
            </p>
          </div>

          {COLUMNS.map(({ heading, links }) => (
            <nav key={heading} aria-label={heading}>
              {/* Heading reads brighter than the links under it — the mono
                  uppercase treatment alone doesn't separate them when both sit
                  at text-muted-foreground. */}
              <h2 className="font-mono text-xs tracking-wide text-foreground uppercase">
                {heading}
              </h2>
              <ul className="mt-4 flex flex-col gap-3">
                {links.map(([label, href]) => (
                  <li key={href}>
                    <Link href={href} className={linkClass}>
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-4 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-mono text-xs text-muted-foreground">
            © {new Date().getFullYear()} Clipper
          </p>
          <ul className="flex flex-wrap gap-x-6 gap-y-2">
            {LEGAL.map(([label, href]) => (
              <li key={href}>
                <Link
                  href={href}
                  className="rounded-sm font-mono text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
                >
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}
