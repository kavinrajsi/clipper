import Link from "next/link";
import { ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCampaignRate, formatCurrency, formatNumber } from "@/lib/format";
import { CLIPPER_STEPS } from "@/lib/marketing";

export const metadata = {
  title: "For clippers",
};

// One worked example, computed rather than written out, so the two tiers can't
// disagree with each other. Multipliers match the ones the connector assigns:
// 1.0 for a linked channel, 0.75 for bio-code verification.
const EXAMPLE = { views: 128402, rate: 520 };
const grossPayout = (EXAMPLE.views / 1000) * EXAMPLE.rate;

const TIERS = [
  {
    method: "verification_method: linked",
    label: "Link your channel",
    multiplier: 1,
    body: "Sign in with the YouTube account. Ownership is verified instantly and you earn the campaign's full rate.",
  },
  {
    method: "verification_method: bio_code",
    label: "Add a bio code",
    multiplier: 0.75,
    body: "Paste a one-time code into your channel description instead of granting ongoing access. Pays 75% of the rate.",
  },
];

export default function ForClippersPage() {
  return (
    <div className="flex flex-1 flex-col">
      {/* Hero */}
      <section className="border-b border-border px-6 py-14 sm:py-20">
        <div className="mx-auto flex max-w-4xl flex-col items-start gap-5">
          <span className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
            For clippers
          </span>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            <span className="block">Cut clips you&apos;d post anyway.</span>
            <span className="block">Get paid for the views.</span>
          </h1>
          <p className="max-w-xl text-lg leading-8 text-muted-foreground">
            Every campaign publishes its rate, budget, and deadline before you
            apply. The clip stays on your channel.
          </p>
          <Button
            size="lg"
            className="h-11 px-6 text-base"
            nativeButton={false}
            render={<Link href="/login" />}
          >
            Connect your channel
          </Button>
        </div>
      </section>

      {/* What a campaign pays */}
      <section className="border-b border-border px-6 py-16">
        <div className="mx-auto max-w-4xl">
          <span className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
            What a campaign pays
          </span>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">
            Two structures, both set before you apply
          </h2>
          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            <div className="rounded-lg border border-border p-5">
              <p className="font-mono text-xs text-muted-foreground">
                payout_structure: per_view
              </p>
              <p className="mt-2 font-medium">A rate per 1,000 views</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Counted from your channel&apos;s synced YouTube data. At{" "}
                {formatCampaignRate({ payout_structure: "per_view", payout_rate: EXAMPLE.rate })},
                a clip that does {formatNumber(EXAMPLE.views)} views pays{" "}
                <span className="text-foreground">{formatCurrency(grossPayout)}</span>.
              </p>
            </div>
            <div className="rounded-lg border border-border p-5">
              <p className="font-mono text-xs text-muted-foreground">
                payout_structure: flat_fee
              </p>
              <p className="mt-2 font-medium">A fixed amount per clip</p>
              <p className="mt-1 text-sm text-muted-foreground">
                The same figure whether the clip does a thousand views or a
                million. Paid once the brand approves your submission.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Signature element: the same clip, two verification tiers */}
      <section className="border-b border-border px-6 py-16">
        <div className="mx-auto max-w-4xl">
          <span className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
            Verification
          </span>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">
            How you verify changes what you earn
          </h2>
          <p className="mt-2 max-w-xl text-muted-foreground">
            Same clip, same campaign, same {formatNumber(EXAMPLE.views)} views —
            the only difference is how you proved the channel is yours.
          </p>

          <div className="mt-8 grid gap-6 sm:grid-cols-2">
            {TIERS.map(({ method, label, multiplier, body }) => (
              <div
                key={method}
                className="flex flex-col rounded-lg border border-border bg-card p-5"
              >
                <p className="font-mono text-xs text-muted-foreground">{method}</p>
                <p className="mt-2 font-medium">{label}</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{body}</p>
                <p className="mt-6 font-mono text-3xl tracking-tight">
                  {formatCurrency(grossPayout * multiplier)}
                </p>
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  payout_multiplier: {multiplier.toFixed(2)}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-6 text-sm text-muted-foreground">
            Either way you can switch later from Connectors.{" "}
            <Link href="/faq" className="underline underline-offset-4 hover:text-foreground">
              More in the FAQ
            </Link>
            .
          </p>
        </div>
      </section>

      {/* How it runs */}
      <section className="border-b border-border px-6 py-16">
        <div className="mx-auto max-w-4xl">
          <span className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
            How it runs
          </span>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">
            From channel to payout
          </h2>
          <ol className="mt-8 grid gap-8 sm:grid-cols-2">
            {CLIPPER_STEPS.map(({ n, title, long }) => (
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

      {/* Getting paid */}
      <section className="border-b border-border px-6 py-16">
        <div className="mx-auto max-w-4xl">
          <span className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
            Getting paid
          </span>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">
            The budget is already funded when you apply
          </h2>
          <ol className="mt-6 grid gap-6 sm:grid-cols-2">
            {[
              [
                "The brand approves your submission",
                "Your payout is computed from the campaign's terms and checked against what's left of the budget.",
              ],
              [
                "A payout is held in Razorpay",
                "Held against the campaign, not promised — the amount is set the moment your submission is approved.",
              ],
              [
                "The brand releases the hold",
                "Once everything checks out on their side, the hold is released.",
              ],
              [
                "Funds settle to your payout account",
                "To the account you connected on Payout account — bank details, PAN, the usual.",
              ],
            ].map(([title, body], i) => (
              <li key={title} className="flex gap-4">
                <span className="font-mono text-sm text-muted-foreground">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <p className="font-medium">{title}</p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">{body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="px-6 py-16">
        <div className="mx-auto flex max-w-4xl flex-col items-start gap-5">
          <h2 className="text-2xl font-semibold tracking-tight">
            Connect a channel and start applying
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
              href="/discover"
              className="group inline-flex items-center gap-1 rounded-sm text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
            >
              See who else is clipping
              <ChevronRightIcon
                className="size-4 transition-transform group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </Link>
            <Link
              href="/for-brands"
              className="group inline-flex items-center gap-1 rounded-sm text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
            >
              Running campaigns instead?
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
