import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { TriangleAlertIcon } from "lucide-react";

export const metadata = {
  title: "Privacy Policy",
};

export default function PrivacyPage() {
  return (
    <article>
      <h1 className="text-3xl font-bold">Privacy Policy</h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated: [DATE]</p>

      <Alert className="mt-6" variant="destructive">
        <TriangleAlertIcon />
        <AlertTitle>Draft — not legal advice</AlertTitle>
        <AlertDescription>
          This is a starting draft, not a finished legal document. Have a lawyer review and
          finalize it before relying on it or launching publicly.
        </AlertDescription>
      </Alert>

      <h2 className="mt-8 text-lg font-semibold">1. Information We Collect</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        When you create an account, we collect your email address, name, and (optionally) a
        profile photo. If you sign up or sign in with Google, we receive your name, email, and
        profile picture from Google.
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        If you connect a YouTube channel, we collect data made available through the YouTube
        Data API and YouTube Analytics API on your behalf, including your channel profile,
        video metadata and statistics (views, likes, comments), recent channel activity, and
        aggregate channel analytics (views, watch time, subscriber changes).
      </p>

      <h2 className="mt-8 text-lg font-semibold">2. How We Use It</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        We use this information to operate your account, display your channel data back to you
        (dashboard, analytics, video list), let brands evaluate clipper profiles for campaigns,
        and calculate campaign performance and payout eligibility.
      </p>

      <h2 className="mt-8 text-lg font-semibold">
        3. Google API Services User Data Policy
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        [PLATFORM NAME]&apos;s use and transfer of information received from Google APIs
        adheres to the{" "}
        <a
          href="https://developers.google.com/terms/api-services-user-data-policy"
          className="underline underline-offset-4"
        >
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements. We only use YouTube data to provide and
        improve the features you see in this app — channel/video/analytics display, campaign
        matching, and payout calculation. We do not sell YouTube data, and we do not use it for
        advertising purposes. We do not allow humans to read this data except where necessary
        for security, legal compliance, or with your consent.
      </p>

      <h2 className="mt-8 text-lg font-semibold">4. Data Sharing</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        We share the minimum clipper profile and channel data necessary with a brand once you
        apply to (or are approved for) their campaign. We do not otherwise sell or share your
        data with third parties, except service providers who help us operate the platform
        (e.g. our hosting and database providers) under confidentiality obligations.
      </p>

      <h2 className="mt-8 text-lg font-semibold">5. Cookies</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        We use essential cookies to keep you signed in and to protect against cross-site
        request forgery during sign-in. We do not currently use advertising or tracking
        cookies.
      </p>

      <h2 className="mt-8 text-lg font-semibold">6. Data Retention</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        We retain your account and channel data for as long as your account is active. You can
        disconnect a connected platform at any time, which stops future syncing; you can
        request deletion of your account and associated data by contacting us.
      </p>

      <h2 className="mt-8 text-lg font-semibold">7. Your Rights</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        You can access, correct, export, or delete your data by contacting us at
        [CONTACT EMAIL]. Depending on your location, you may have additional rights under laws
        like the GDPR or CCPA.
      </p>

      <h2 className="mt-8 text-lg font-semibold">8. Children&apos;s Privacy</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        This platform is not directed at children under 13 (or the minimum age in your
        jurisdiction), and we do not knowingly collect data from them.
      </p>

      <h2 className="mt-8 text-lg font-semibold">9. Changes to This Policy</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        We may update this policy from time to time. Material changes will be announced in the
        app or by email.
      </p>

      <h2 className="mt-8 text-lg font-semibold">10. Contact</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Questions about this policy? Contact us at [CONTACT EMAIL].
      </p>
    </article>
  );
}
