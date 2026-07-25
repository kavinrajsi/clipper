import { Fragment } from "react";
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
      <section className="border-b border-border px-6 py-20 sm:py-28">
        <div className="mx-auto flex max-w-4xl flex-col items-start gap-8">
          <span className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
            YouTube clip marketplace
          </span>
          <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
            Brands post the campaign.
            <br />
            Clippers cut the footage.
          </h1>
          <p className="max-w-xl text-lg leading-8 text-muted-foreground">
            Clipper connects brands running YouTube campaigns with clippers
            who edit and publish clips against them — paid per view or a flat
            fee, set by the brand up front.
          </p>

          {/* Signature element: timeline scrubber with cut marks + payout readout */}
          <div className="w-full max-w-xl rounded-lg border border-border bg-card px-4 py-3">
            <div className="relative flex h-8 items-center">
              <span className="font-mono text-xs text-muted-foreground">[</span>
              <div className="relative mx-1 h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div className="absolute inset-y-0 left-[18%] right-[34%] rounded-full bg-foreground/70" />
                <span
                  className="absolute top-1/2 left-[18%] size-2 -translate-y-1/2 rounded-full bg-[oklch(0.63_0.24_25)] motion-safe:animate-pulse"
                  aria-hidden="true"
                />
              </div>
              <span className="font-mono text-xs text-muted-foreground">]</span>
            </div>
            <div className="mt-1 flex items-center justify-between font-mono text-xs text-muted-foreground">
              <span>00:00:04.120 in — 00:00:19.860 out</span>
              <span className="text-foreground">128,402 views · $6.42 / 1,000 views</span>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              size="lg"
              className="h-11 px-6 text-base"
              nativeButton={false}
              render={<Link href="/login" />}
            >
              Post a campaign
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-11 px-6 text-base"
              nativeButton={false}
              render={<Link href="/campaigns" />}
            >
              Browse open campaigns
            </Button>
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
          <div className="mt-8 flex flex-col gap-8 sm:flex-row sm:items-start sm:gap-1">
            {PROCESS_STEPS.map(([n, Icon, title, body], i) => (
              <Fragment key={n}>
                <div className="flex flex-1 flex-col gap-3">
                  <div className="flex size-10 items-center justify-center rounded-lg border border-border">
                    <Icon className="size-5 text-muted-foreground" />
                  </div>
                  <div>
                    <span className="font-mono text-xs text-muted-foreground">{n}</span>
                    <p className="mt-1 font-medium">{title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{body}</p>
                  </div>
                </div>
                {i < PROCESS_STEPS.length - 1 && (
                  <ChevronRightIcon
                    className="hidden size-4 shrink-0 self-center text-muted-foreground/30 sm:block"
                    aria-hidden="true"
                  />
                )}
              </Fragment>
            ))}
          </div>
        </div>
      </section>

      {/* Two pipelines */}
      <section className="border-b border-border px-6 py-16">
        <div className="mx-auto grid max-w-4xl gap-12 sm:grid-cols-2">
          <div className="flex flex-col gap-6">
            <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
              For brands
            </h2>
            <ol className="flex flex-col gap-5">
              {[
                ["01", "Post a campaign", "Set requirements, a deadline, and pay per view or a flat fee."],
                ["02", "Review applicants", "Clippers apply with a note — approve or reject each one."],
                ["03", "Clippers publish", "Approved clippers cut and post against your campaign."],
                ["04", "Track it in analytics", "Views, likes, and comments roll up per connected channel."],
              ].map(([n, title, body]) => (
                <li key={n} className="flex gap-4">
                  <span className="font-mono text-sm text-muted-foreground">{n}</span>
                  <div>
                    <p className="font-medium">{title}</p>
                    <p className="text-sm text-muted-foreground">{body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="flex flex-col gap-6">
            <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
              For clippers
            </h2>
            <ol className="flex flex-col gap-5">
              {[
                ["01", "Connect your channel", "Link YouTube by OAuth, or verify with a bio code."],
                ["02", "Apply to campaigns", "Browse active campaigns and apply with a short pitch."],
                ["03", "Cut & publish", "Once approved, edit and post your clip to your channel."],
                ["04", "Get paid on terms", "Per-view or flat fee — whatever the campaign set."],
              ].map(([n, title, body]) => (
                <li key={n} className="flex gap-4">
                  <span className="font-mono text-sm text-muted-foreground">{n}</span>
                  <div>
                    <p className="font-medium">{title}</p>
                    <p className="text-sm text-muted-foreground">{body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* Verification / trust */}
      <section className="border-b border-border px-6 py-16">
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

      {/* Closing CTA */}
      <section className="px-6 py-16">
        <div className="mx-auto flex max-w-4xl flex-col items-start gap-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Set the terms, or work to them.
          </h2>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              nativeButton={false}
              render={<Link href="/login" />}
            >
              Sign in
            </Button>
          </div>
          <div className="mt-2 flex gap-4 font-mono text-xs text-muted-foreground">
            <Link href="/terms" className="hover:text-foreground">Terms</Link>
            <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
            <Link href="/clipper-terms" className="hover:text-foreground">Clipper terms</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
