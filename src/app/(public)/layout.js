import { Footer } from "@/components/footer";
import { Header } from "@/components/header";

// Publicly readable pages — no auth required, and deliberately NOT listed in
// PROTECTED_PATH_PREFIXES (src/lib/supabase/proxy.js). Header renders the
// account dropdown when there is a session and a Sign in button when there
// isn't, so the same shell serves both.
export default function PublicLayout({ children }) {
  return (
    <div className="flex min-h-svh flex-col">
      <Header />
      <div className="flex flex-1 flex-col">{children}</div>
      <Footer />
    </div>
  );
}
