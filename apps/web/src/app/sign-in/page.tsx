import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/illustrations/logo";
import { SignInForm } from "@/features/auth/sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string; expired?: string; mode?: string; reset?: string; signedOut?: string; deleted?: string }> }) {
  const { next, expired, mode, reset, signedOut, deleted } = await searchParams;
  return (
    <main className="bg-app-gradient flex min-h-dvh items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 flex justify-center text-xl" aria-label="HealthMate welcome">
          <Logo size={32} />
        </Link>
        <div className="rounded-xl bg-card p-7 shadow-card">
          <h1 className="text-page-heading text-text-primary">Welcome</h1>
          <p className="mt-1 mb-6 text-body text-text-secondary">Sign in or create an account to use HealthMate.</p>
          <SignInForm next={next} expired={expired === "1"} passwordReset={reset === "1"}
            notice={deleted === "1" ? "Your account and all its data were deleted." : signedOut === "1" ? "You've signed out." : undefined} initialMode={mode === "sign-up" ? "sign-up" : "sign-in"} />
        </div>
        <p className="mt-6 text-center text-caption text-text-secondary">HealthMate offers general information, not a diagnosis.</p>
      </div>
    </main>
  );
}
