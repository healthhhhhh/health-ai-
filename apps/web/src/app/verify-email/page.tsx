import type { Metadata } from "next";
import { AlertCircle } from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/illustrations/logo";
import { ButtonLink } from "@/components/ui/button";
import { VerifyEmailPanel } from "@/features/auth/verify-email-panel";
import { isPreviewMode } from "@/lib/preview/mode";

export const metadata: Metadata = { title: "Confirm your email" };
export const dynamic = "force-dynamic";

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ email?: string; status?: string }> }) {
  const { email = "", status } = await searchParams;
  const failed = status === "invalid" || status === "failed";
  return (
    <main className="bg-app-gradient flex min-h-dvh items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 flex justify-center text-xl" aria-label="HealthMate welcome">
          <Logo size={32} />
        </Link>
        <div className="rounded-xl bg-card p-7 shadow-card">
          {failed ? (
            <>
              <h1 className="text-page-heading text-text-primary">{status === "invalid" ? "This link has expired" : "We couldn't confirm your email"}</h1>
              <p role="alert" className="mt-3 mb-6 flex gap-2 rounded-md bg-error-soft p-3 text-caption font-medium text-error">
                <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
                {status === "invalid"
                  ? "Confirmation links work once and expire after a while. Sign in with your email to get a new one."
                  : "Something went wrong on our side. Please try the link again in a moment."}
              </p>
              <ButtonLink href="/sign-in" size="lg" fullWidth>
                Back to sign in
              </ButtonLink>
            </>
          ) : (
            <>
              <h1 className="text-page-heading text-text-primary">Check your email</h1>
              <p className="mt-1 mb-6 text-body text-text-secondary">One more step to keep your health information secure.</p>
              <VerifyEmailPanel email={email} preview={isPreviewMode()} />
            </>
          )}
        </div>
      </div>
    </main>
  );
}
