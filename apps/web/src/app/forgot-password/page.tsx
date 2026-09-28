import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/illustrations/logo";
import { ForgotPasswordForm } from "@/features/auth/reset-forms";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  return (
    <main className="bg-app-gradient flex min-h-dvh items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 flex justify-center text-xl" aria-label="HealthMate welcome">
          <Logo size={32} />
        </Link>
        <div className="rounded-xl bg-card p-7 shadow-card">
          <h1 className="text-page-heading text-text-primary">Forgot your password?</h1>
          <p className="mt-1 mb-6 text-body text-text-secondary">Enter your email and we&apos;ll send you a link to choose a new one.</p>
          <ForgotPasswordForm />
        </div>
      </div>
    </main>
  );
}
