import Link from "next/link";
import { ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCampaignRate, formatCurrency } from "@/lib/format";
import { BRAND_STEPS } from "@/lib/marketing";

export const metadata = {
  title: "For brands",
};

// The fields a brand actually fills in, in the order campaign-form.jsx asks for
// them. Values render through the same formatters the live campaign pages use.
const SPEC_ROWS = [
  {
    key: "title",
    value: "Podcast ep. 214 — best moments",
    note: "What clippers see in the campaign list.",
  },
  {
    key: "requirements",
    value: "Vertical 9:16, under 60s, burned-in captions",
    note: "Free text. The brief you'd otherwise send over email.",
  },
  {
    key: "payout_structure",
    value: "per_view",
    note: "Or flat_fee — a fixed amount per approved clip.",
  },
  {
    key: "payout_rate",
    value: formatCampaignRate({ payout_structure: "cpm", payout_rate: 520 }),
    note: "Computed from view counts synced off the YouTube Data API.",
  },
  {
    key: "budget",
    value: formatCurrency(100000),
    note: "Funded up front. Total payouts can never exceed it.",
  },
  {
    key: "deadline",
    value: "31/08/2026",
    note: "After this, the campaign stops accepting submissions.",
  },
  {
    key: "visibility",
    value: "public",
    note: "Or invite_only / private — see below.",
  },
];

const VISIBILITY = [
  ["Anyone", "Listed for every clipper once the campaign is funded and active."],
  ["Invite only", "Unlisted. Only clippers you invite can see it or apply."],
  ["Private", "Unlisted, and not accepting new applicants."],
];

export default function ForBrandsPage() {
  return (
    <div className="flex flex-1 flex-col">
      {/* Hero */}
      <section className="border-b border-border px-6 py-14 sm:py-20">
        <div className="mx-auto flex max-w-4xl flex-col items-start gap-5">
          <span className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
            For brands
          </span>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            <span className="block">You write the brief.</span>
            <span className="block">Clippers do the cutting.</span>
          </h1>
          <p className="max-w-xl text-lg leading-8 text-muted-foreground">
            Post what you want cut, set the rate, and pay only for clips you
            approve.
          </p>
          <Button
            size="lg"
            className="h-11 px-6 text-base"
            nativeButton={false}
            render={<Link href="/login" />}
          >
            Post a campaign
          </Button>
        </div>
      </section>

      {/* Signature element: the campaign form as a filled-in spec */}
      <section className="border-b border-border px-6 py-16">
        <div className="mx-auto max-w-4xl">
          <span className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
            The campaign spec
          </span>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">
            Seven fields, then it&apos;s live
          </h2>
          <p className="mt-2 max-w-xl text-muted-foreground">
            This is the whole form. Nothing is negotiated in a thread afterwards
            — every clipper applies against these terms as written.
          </p>

          <dl className="mt-8 divide-y divide-border rounded-lg border border-border">
            {SPEC_ROWS.map(({ key, value, note }) => (
              <div
                key={key}
                className="grid gap-1 p-4 sm:grid-cols-[11rem_1fr] sm:gap-4"
              >
                <dt className="font-mono text-xs text-muted-foreground">{key}</dt>
                <dd>
                  <p className="font-mono text-sm">{value}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{note}</p>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Visibility */}
      <section className="border-b border-border px-6 py-16">
        <div className="mx-auto max-w-4xl">
          <span className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
            Who can see it
          </span>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">
            Open to everyone, or to a list you pick
          </h2>
          <div className="mt-6 grid gap-6 sm:grid-cols-3">
            {VISIBILITY.map(([label, description]) => (
              <div key={label} className="rounded-lg border border-border p-5">
                <p className="font-medium">{label}</p>
                <p className="mt-1 text-sm text-muted-foreground">{description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it runs */}
      <section className="border-b border-border px-6 py-16">
        <div className="mx-auto max-w-4xl">
          <span className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
            How it runs
          </span>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">
            From brief to published clip
          </h2>
          <ol className="mt-8 grid gap-8 sm:grid-cols-2">
            {BRAND_STEPS.map(({ n, title, long }) => (
              <li key={n} className="flex gap-4">
                <span className="font-mono text-sm text-muted-foreground">{n}</span>
                <div>
                  <p className="font-medium">{title}</p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">{long}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Funding */}
      <section className="border-b border-border px-6 py-16">
        <div className="mx-auto max-w-4xl">
          <span className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
            Funding
          </span>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">
            The budget is funded before anyone applies
          </h2>
          <div className="mt-6 grid gap-6 sm:grid-cols-3">
            <div className="rounded-lg border border-border p-5">
              <p className="font-medium">Pay the budget up front</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Fund the campaign through Razorpay Checkout. It goes live once
                the payment is confirmed — not before.
              </p>
            </div>
            <div className="rounded-lg border border-border p-5">
              <p className="font-medium">Payouts draw from it</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Each approved submission is checked against what&apos;s left.
                Total payouts can never exceed the budget you funded.
              </p>
            </div>
            <div className="rounded-lg border border-border p-5">
              <p className="font-medium">Clippers know it&apos;s real</p>
              <p className="mt-1 text-sm text-muted-foreground">
                A funded campaign is the reason good clippers apply. The money
                is already in before they spend an evening editing.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="px-6 py-16">
        <div className="mx-auto flex max-w-4xl flex-col items-start gap-5">
          <h2 className="text-2xl font-semibold tracking-tight">
            Post your first campaign
          </h2>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <Button
              size="lg"
              className="h-11 px-6 text-base"
              nativeButton={false}
              render={<Link href="/login" />}
            >
              Get started
            </Button>
            <Link
              href="/for-clippers"
              className="group inline-flex items-center gap-1 rounded-sm text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
            >
              Clipping instead? Read that side
              <ChevronRightIcon
                className="size-4 transition-transform group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
