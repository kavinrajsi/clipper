import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { TriangleAlertIcon } from "lucide-react";

export const metadata = {
  title: "Terms of Service",
};

export default function TermsPage() {
  return (
    <article>
      <h1 className="text-3xl font-bold">Terms of Service</h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated: [DATE]</p>

      <Alert className="mt-6" variant="destructive">
        <TriangleAlertIcon />
        <AlertTitle>Draft — not legal advice</AlertTitle>
        <AlertDescription>
          This is a starting draft, not a finished legal document. Have a lawyer review and
          finalize it before relying on it or launching publicly.
        </AlertDescription>
      </Alert>

      <h2 className="mt-8 text-lg font-semibold">1. Accounts & Eligibility</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        You must provide accurate information when creating an account and choose whether
        you’re signing up as a Brand or a Clipper. You’re responsible for activity under your
        account and for keeping your login credentials secure.
      </p>

      <h2 className="mt-8 text-lg font-semibold">2. Acceptable Use</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Don’t misrepresent your identity or channel ownership, don’t submit fraudulent view or
        engagement data, and don’t use the platform for unlawful, infringing, or abusive
        purposes.
      </p>

      <h2 className="mt-8 text-lg font-semibold">3. Campaigns</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Brands may create campaigns describing the content they want, a payout structure, and a
        budget. Clippers may apply to active campaigns; a brand may approve or reject an
        application at its discretion. Approval does not itself guarantee payment — see the
        Clipper Terms and each campaign’s specific requirements.
      </p>

      <h2 className="mt-8 text-lg font-semibold">4. Payments</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Brands fund a campaign’s budget through Razorpay before it goes active. When a brand
        approves a clipper’s submission, the payout amount is transferred to Razorpay on hold;
        the brand releases the hold to complete payment to the clipper’s connected payout
        account. Clippers must complete payout account verification before funds can be
        released to them.
      </p>

      <h2 className="mt-8 text-lg font-semibold">5. Intellectual Property</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        You retain ownership of content you upload or link to your account. By applying to a
        campaign, you agree to license specific content to the brand as described in the{" "}
        <Link href="/clipper-terms" className="underline underline-offset-4">
          Clipper Terms
        </Link>
        .
      </p>

      <h2 className="mt-8 text-lg font-semibold">6. Termination</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        We may suspend or terminate accounts that violate these terms. You may stop using the
        platform and request account deletion at any time.
      </p>

      <h2 className="mt-8 text-lg font-semibold">7. Disclaimers & Limitation of Liability</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        The platform is provided “as is” without warranties of any kind. To the maximum extent
        permitted by law, [PLATFORM NAME] is not liable for indirect, incidental, or
        consequential damages arising from your use of the platform.
      </p>

      <h2 className="mt-8 text-lg font-semibold">8. Governing Law</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        These terms are governed by the laws of [JURISDICTION], without regard to conflict of
        law principles.
      </p>

      <h2 className="mt-8 text-lg font-semibold">9. Changes</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        We may update these terms from time to time. Continued use of the platform after
        changes take effect constitutes acceptance of the updated terms.
      </p>

      <h2 className="mt-8 text-lg font-semibold">10. Contact</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Questions about these terms? Contact us at [CONTACT EMAIL].
      </p>
    </article>
  );
}
