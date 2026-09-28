import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/illustrations/logo";
import { ResetPasswordForm } from "@/features/auth/reset-forms";

export const metadata: Metadata = { title: "Choose a new password" };

export default function ResetPasswordPage() {
  return (
    <main className="bg-app-gradient flex min-h-dvh items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 flex justify-center text-xl" aria-label="HealthMate welcome">
          <Logo size={32} />
        </Link>
        <div className="rounded-xl bg-card p-7 shadow-card">
          <h1 className="text-page-heading text-text-primary">Choose a new password</h1>
          <p className="mt-1 mb-6 text-body text-text-secondary">You&apos;ll be signed out on your other devices.</p>
          <ResetPasswordForm />
        </div>
      </div>
    </main>
  );
}
