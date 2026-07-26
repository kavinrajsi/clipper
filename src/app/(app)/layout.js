import { Footer } from "@/components/footer";
import { Header } from "@/components/header";

export default function AppLayout({ children }) {
  return (
    <div className="flex min-h-svh flex-col">
      <Header />
      <div className="flex flex-1 flex-col">{children}</div>
      <Footer />
    </div>
  );
}
