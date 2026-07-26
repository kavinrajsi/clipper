import Link from "next/link";
import {
  ChevronRightIcon,
  PlayIcon,
  ScanSearchIcon,
  ScissorsIcon,
  SmartphoneIcon,
  UploadIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCampaignRate, formatNumber } from "@/lib/format";
import { BRAND_STEPS, CLIPPER_STEPS } from "@/lib/marketing";

const PROCESS_STEPS = [
  [
    "01",
    PlayIcon,
    "Long-form source",
    "Podcasts, streams, interviews — the raw footage a campaign starts from.",
  ],
  [
    "02",
    ScanSearchIcon,
    "Find the moment",
    "Clippers scrub the timeline for the segment worth cutting.",
  ],
  [
    "03",
    ScissorsIcon,
    "Cut & refine",
    "Trim the in/out points, add captions, tighten the pacing.",
  ],
  [
    "04",
    SmartphoneIcon,
    "Export the clip",
    "A short, vertical cut — ready to post.",
  ],
  [
    "05",
    UploadIcon,
    "Publish to YouTube",
    "Live against the campaign — views start counting toward the payout.",
  ],
];

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      {/* Hero */}
      <section className="border-b border-border px-6 py-14 sm:py-20">
        <div className="mx-auto grid max-w-4xl items-start gap-x-10 gap-y-8 lg:grid-cols-[1.05fr_0.95fr]">
          {/* Spans both columns: at text-5xl neither sentence fits a half-width
              column, and a ragged 3-line wrap kills the two-sided parallel. */}
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl lg:col-span-2">
            <span className="block">Brands post the campaign.</span>
            <span className="block">Clippers cut the footage.</span>
          </h1>

          <div className="flex flex-col items-start gap-5">
            <p className="text-lg leading-8 text-muted-foreground">
              Paid per view or a flat fee — set by the brand up front.
            </p>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <Button
                size="lg"
                className="h-11 px-6 text-base"
                nativeButton={false}
                render={<Link href="/login" />}
              >
                Post a campaign
              </Button>
              <Link
                href="/campaigns"
                className="group inline-flex items-center gap-1 rounded-sm text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
              >
                Browse open campaigns
                <ChevronRightIcon
                  className="size-4 transition-transform group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </Link>
            </div>
          </div>

          {/* Signature element: timeline scrubber with cut marks + payout readout */}
          <div className="w-full rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-1">
              <span className="font-mono text-xs text-muted-foreground">[</span>
              {/* No overflow-hidden: the playhead is taller than the track and
                  would render as a clipped square. */}
              <div className="relative h-1.5 flex-1 rounded-full bg-muted">
                <div className="absolute inset-y-0 left-[18%] right-[34%] rounded-full bg-foreground/70" />
                <span
                  className="absolute top-1/2 left-[18%] size-2 -translate-y-1/2 rounded-full bg-[oklch(0.63_0.24_25)] motion-safe:animate-pulse"
                  aria-hidden="true"
                />
              </div>
              <span className="font-mono text-xs text-muted-foreground">]</span>
            </div>
            <p className="mt-3 font-mono text-xs text-muted-foreground">
              00:00:04.120 in — 00:00:19.860 out
            </p>
            <p className="mt-4 font-mono text-2xl tracking-tight">
              {formatNumber(128402)} views
            </p>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {formatCampaignRate({ payout_structure: "per_view", payout_rate: 520 })}
            </p>
          </div>
        </div>
      </section>

      {/* The process */}
      <section className="border-b border-border px-6 py-16">
        <div className="mx-auto max-w-4xl">
          <span className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
            The process
          </span>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">
            From raw footage to a paid view
          </h2>
          {/* Three across, so five steps land 3 + 2. The step number carries
              the order — a wrapped row can't, which is why the chevrons went. */}
          <ol className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {PROCESS_STEPS.map(([n, Icon, title, body]) => (
              <li
                key={n}
                className="flex flex-col gap-3 rounded-lg border border-border p-5"
              >
                <div className="flex items-center justify-between">
                  <div className="flex size-10 items-center justify-center rounded-lg border border-border">
                    <Icon className="size-5 text-muted-foreground" />
                  </div>
                  <span className="font-mono text-xs text-muted-foreground">{n}</span>
                </div>
                <div>
                  <p className="font-medium">{title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Two pipelines */}
      <section className="border-b border-border px-6 py-16">
        <div className="mx-auto grid max-w-4xl gap-12 sm:grid-cols-2">
          <div className="flex flex-col items-start gap-6">
            <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
              For brands
            </h2>
            <ol className="flex flex-col gap-5">
              {BRAND_STEPS.map(({ n, title, short }) => (
                <li key={n} className="flex gap-4">
                  <span className="font-mono text-sm text-muted-foreground">{n}</span>
                  <div>
                    <p className="font-medium">{title}</p>
                    <p className="text-sm text-muted-foreground">{short}</p>
                  </div>
                </li>
              ))}
            </ol>
            <Link
              href="/for-brands"
              className="group inline-flex items-center gap-1 rounded-sm text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
            >
              Learn more
              <ChevronRightIcon
                className="size-4 transition-transform group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </Link>
          </div>

          <div className="flex flex-col items-start gap-6">
            <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
              For clippers
            </h2>
            <ol className="flex flex-col gap-5">
              {CLIPPER_STEPS.map(({ n, title, short }) => (
                <li key={n} className="flex gap-4">
                  <span className="font-mono text-sm text-muted-foreground">{n}</span>
                  <div>
                    <p className="font-medium">{title}</p>
                    <p className="text-sm text-muted-foreground">{short}</p>
                  </div>
                </li>
              ))}
            </ol>
            <Link
              href="/for-clippers"
              className="group inline-flex items-center gap-1 rounded-sm text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
            >
              Learn more
              <ChevronRightIcon
                className="size-4 transition-transform group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </Link>
          </div>
        </div>
      </section>

      {/* Verification / trust — last section, so no border-b: the footer's
          closing-bracket rule is the divider. */}
      <section className="px-6 py-16">
        <div className="mx-auto max-w-4xl">
          <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
            Channel verification
          </h2>
          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            <div className="rounded-lg border border-border p-5">
              <p className="font-mono text-xs text-muted-foreground">verification_method: linked</p>
              <p className="mt-2 font-medium">Connect with OAuth</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Sign in with the YouTube account directly — ownership is
                verified instantly, no waiting.
              </p>
            </div>
            <div className="rounded-lg border border-border p-5">
              <p className="font-mono text-xs text-muted-foreground">verification_method: bio_code</p>
              <p className="mt-2 font-medium">Verify with a bio code</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Can&apos;t connect the account? Drop a one-time code in your
                channel bio and confirm ownership that way instead.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
