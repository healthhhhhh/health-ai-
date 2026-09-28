import Link from "next/link";
import { Logo } from "@/components/illustrations/logo";

/** Public: legal and help content is readable without an account. */
export default function HelpLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b border-separator/70 bg-background/85">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-4 sm:px-6">
          <Link href="/" className="text-lg" aria-label="HealthMate welcome">
            <Logo size={26} />
          </Link>
          <Link href="/home" className="ml-auto text-caption font-semibold text-primary underline-offset-4 hover:underline">
            Open HealthMate
          </Link>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        {children}
      </main>
    </div>
  );
}
