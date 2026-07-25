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
      "Payouts aren't live yet. Campaigns show a payout structure and rate for reference, but no real money moves through the platform today. This will change once a payment processor is integrated — see the Terms of Service for the current status.",
  },
  {
    question: "Why isn't my YouTube data syncing?",
    answer:
      "Go to Connectors and hit \"Sync now.\" If nothing updates, try disconnecting and reconnecting your account — your Google OAuth token may have expired or been revoked.",
  },
  {
    question: "Can I be both a brand and a clipper?",
    answer:
      "Not currently. Your role (Brand or Clipper) is chosen at signup and can't be switched from the app.",
  },
  {
    question: "How do I change my role?",
    answer: "There's no self-serve way to do this yet — contact support and we'll sort it out.",
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
