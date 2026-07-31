import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = {
  title: "Support",
};

export default function SupportPage() {
  return (
    <article>
      <h1 className="text-3xl font-bold">Support</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Check the{" "}
        <Link href="/faq" className="underline underline-offset-4">
          FAQ
        </Link>{" "}
        first — most common questions are answered there. Otherwise, reach us directly.
      </p>

      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Contact us</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Email us at{" "}
            <a href="mailto:[CONTACT EMAIL]" className="underline underline-offset-4">
              [CONTACT EMAIL]
            </a>{" "}
            and we’ll get back to you.
          </p>
        </CardContent>
      </Card>

      <h2 className="mt-8 text-lg font-semibold">Common issues</h2>
      <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
        <li>
          <strong>Connector not syncing</strong> — go to{" "}
          <Link href="/connectors" className="underline underline-offset-4">
            Connectors
          </Link>{" "}
          and hit “Sync now.” If that doesn’t help, try disconnecting and reconnecting.
        </li>
        <li>
          <strong>Signed up with the wrong role</strong> — switch between Clipper and Brand
          anytime from your{" "}
          <Link href="/profile" className="underline underline-offset-4">
            Profile
          </Link>{" "}
          page.
        </li>
      </ul>
    </article>
  );
}
