import Link from "next/link";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export const metadata = {
  title: "FAQ",
};

const FAQS = [
  {
    question: "What's the difference between linking my account and adding a bio code?",
    answer:
      "Linking your account connects your YouTube channel via Google sign-in and qualifies you for the full campaign payout rate. Adding a bio code is a lighter verification — paste a code into your channel description instead of granting ongoing access — and qualifies you for 75% of the rate. Both are set up from the Connectors page.",
  },
  {
    question: "How do I apply to a campaign?",
    answer:
      "Go to Campaigns, browse active campaigns, and click Apply on one you're interested in. The brand reviews your application and approves or rejects it — applying doesn't guarantee approval.",
  },
  {
    question: "When do I get paid?",
    answer:
      "Once a brand funds a campaign and approves your submission, we create a held payout in Razorpay for the campaign's rate. The brand releases the hold once everything checks out, and the funds settle to your connected payout account.",
  },
  {
    question: "Why isn't my YouTube data syncing?",
    answer:
      "Go to Connectors and hit \"Sync now.\" If nothing updates, try disconnecting and reconnecting your account — your Google OAuth token may have expired or been revoked.",
  },
  {
    question: "Can I be both a brand and a clipper?",
    answer:
      "You can't act as both at once, but you're not locked into your original choice — switch anytime from Profile.",
  },
  {
    question: "How do I change my role?",
    answer: "Go to Profile and use the Clipper/Brand toggle — it's self-serve, no need to contact support.",
  },
  {
    question: "How quickly will I get a response?",
    answer:
      "We aim to respond within 24 hours on business days. If it's urgent — a payment or payout issue — mention that in your email subject line.",
  },
  {
    question: "What information should I include when I contact support?",
    answer:
      "Your account email, what you were trying to do, and the campaign or connector involved if relevant. The more specific you are, the faster we can help.",
  },
  {
    question: "Where do my view counts come from, and how accurate are they?",
    answer:
      "View counts come directly from the YouTube Data API once you connect your channel and hit \"Sync now\" on Connectors. Payouts are calculated from those synced numbers — there's no separate bot-traffic filtering today.",
  },
  {
    question: "Does Clipper support platforms other than YouTube?",
    answer:
      "Not yet — campaigns and payouts are YouTube-only right now. If that changes we'll announce it here.",
  },
  {
    question: "What analytics can I see?",
    answer:
      "Once your channel is connected and synced, the Analytics page shows daily views, watch time, subscriber growth, and per-video stats.",
  },
  {
    question: "Is my data secure?",
    answer:
      "We take reasonable steps to protect your data and don't share it with third parties beyond what's needed to process payments. See the Privacy Policy for details.",
  },
];

export default function FaqPage() {
  return (
    <article>
      <h1 className="text-3xl font-bold">Frequently Asked Questions</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Can&apos;t find what you&apos;re looking for?{" "}
        <Link href="/support" className="underline underline-offset-4">
          Contact support
        </Link>
        .
      </p>

      <Accordion className="mt-8">
        {FAQS.map((faq, index) => (
          <AccordionItem key={faq.question} value={`item-${index}`}>
            <AccordionTrigger>{faq.question}</AccordionTrigger>
            <AccordionContent>{faq.answer}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </article>
  );
}
