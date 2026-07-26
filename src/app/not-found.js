import Link from "next/link";
import { FileQuestionIcon } from "lucide-react";
import { Footer } from "@/components/footer";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

export const metadata = {
  title: "Page not found",
};

// The root 404 sits outside every route group, so it gets no group layout and
// has to bring its own shell. A wrong URL is a place to offer a way onward, not
// a dead end, hence the footer's full set of links.
//
// The masthead here is a plain link, NOT <Header/>. Next.js includes this file
// in every route's tree, and Header is an async component that calls
// supabase.auth.getUser() — importing it turns every static page in the app
// (/faq, /privacy, /terms, /support) dynamic, because reading cookies opts a
// route out of static rendering. Verified via the build output.
//
// /c/[handle] keeps its own not-found.js — an unpublished profile needs copy
// that does not confirm the handle exists.
export default function NotFound() {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b px-6 py-4">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <Logo className="size-5" />
          Clipper
        </Link>
      </header>
      <div className="flex flex-1 flex-col justify-center p-6">
        <Empty className="mx-auto w-full max-w-md">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileQuestionIcon />
            </EmptyMedia>
            <EmptyTitle>Page not found</EmptyTitle>
            <EmptyDescription>
              This URL doesn&apos;t match anything on Clipper. It may have moved,
              or the link may have been mistyped.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button nativeButton={false} render={<Link href="/" />}>
                Go home
              </Button>
              <Button variant="outline" nativeButton={false} render={<Link href="/discover" />}>
                Find creators
              </Button>
            </div>
          </EmptyContent>
        </Empty>
      </div>
      <Footer />
    </div>
  );
}
