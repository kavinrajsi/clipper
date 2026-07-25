import Link from "next/link";
import { CommandIcon } from "lucide-react";

export default function LegalLayout({ children }) {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b px-6 py-4">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <CommandIcon className="size-5" />
          Clipper
        </Link>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">{children}</main>
    </div>
  );
}
