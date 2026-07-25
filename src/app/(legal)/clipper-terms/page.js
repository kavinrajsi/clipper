import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { TriangleAlertIcon } from "lucide-react";

export const metadata = {
  title: "Clipper Terms",
};

export default function ClipperTermsPage() {
  return (
    <article>
      <h1 className="text-3xl font-bold">Clipper Terms</h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated: [DATE]</p>

      <Alert className="mt-6" variant="destructive">
        <TriangleAlertIcon />
        <AlertTitle>Draft — not legal advice</AlertTitle>
        <AlertDescription>
          This is a starting draft, not a finished legal document. Have a lawyer review and
          finalize it before relying on it or launching publicly.
        </AlertDescription>
      </Alert>

      <p className="mt-6 text-sm text-muted-foreground">
        These terms apply specifically to clippers using the platform to connect a channel,
        build a clipper profile, and apply to brand campaigns. They supplement, and don't
        replace, the general Terms of Service.
      </p>

      <h2 className="mt-8 text-lg font-semibold">1. Eligibility</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        You must own or have authorization to represent the YouTube channel you connect. You
        must sign up with the Clipper role to access clipper features.
      </p>

      <h2 className="mt-8 text-lg font-semibold">2. Channel Verification</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        To connect a channel, you choose one of two verification methods:
      </p>
      <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">
        <li>
          <strong>Link your account</strong> — directly connect your channel via Google
          OAuth. This is treated as full verification and qualifies you for the full campaign
          payout rate.
        </li>
        <li>
          <strong>Add a code to your bio</strong> — paste a platform-issued code into your
          channel description to prove ownership without granting ongoing access. This
          qualifies you for 75% of the campaign payout rate, reflecting the lighter-weight
          verification.
        </li>
      </ul>
      <p className="mt-2 text-sm text-muted-foreground">
        We may re-verify your channel at any time and may adjust or revoke your verification
        status if we find it was obtained fraudulently.
      </p>

      <h2 className="mt-8 text-lg font-semibold">3. Content Ownership & License</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        You retain ownership of the content on your channel. By applying to and being approved
        for a campaign, you grant the brand a non-exclusive license to reference, feature, or
        repost the specific content covered by that campaign, for the purposes described in the
        campaign listing.
      </p>

      <h2 className="mt-8 text-lg font-semibold">4. Payout Terms</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        <strong>Not yet implemented.</strong> Campaigns display a payout structure (per 1,000
        views or a flat fee) and rate, adjusted by your verification tier. No real payouts are
        processed today — this section will be replaced with real payment terms (timing,
        method, minimum thresholds, dispute process) once a payment processor is integrated.
      </p>

      <h2 className="mt-8 text-lg font-semibold">5. Prohibited Content</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        You may not submit or represent content that infringes third-party rights, violates
        YouTube's own policies, contains fraudulent engagement, or otherwise violates
        applicable law.
      </p>

      <h2 className="mt-8 text-lg font-semibold">6. Application & Approval Process</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Applying to a campaign does not guarantee approval. Brands review applications and may
        approve or reject them at their discretion. You may not represent yourself as approved
        for or affiliated with a campaign until the brand has approved your application.
      </p>

      <h2 className="mt-8 text-lg font-semibold">7. Account Suspension</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        We may suspend your clipper access for violations of these terms, fraudulent
        verification, or fraudulent campaign activity.
      </p>

      <h2 className="mt-8 text-lg font-semibold">8. Dispute Resolution</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Disputes between clippers and brands regarding campaign performance or content use
        should first be raised with [PLATFORM NAME] support at [CONTACT EMAIL].
      </p>

      <h2 className="mt-8 text-lg font-semibold">9. Changes</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        We may update these terms from time to time. Continued use of clipper features after
        changes take effect constitutes acceptance of the updated terms.
      </p>
    </article>
  );
}
