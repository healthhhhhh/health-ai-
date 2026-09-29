import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { ChangePasswordForm } from "@/features/auth/change-password-form";
import { SignOutButton } from "@/features/auth/sign-out-button";
import { getAccount, getProfile } from "@/lib/api/data";

export const metadata: Metadata = { title: "Account" };
export const dynamic = "force-dynamic";

const METHOD = { password: "Email and password", apple: "Apple", google: "Google" } as const;

export default async function AccountPage() {
  const [account, { profile }] = await Promise.all([getAccount(), getProfile()]);
  const hasPassword = !account || account.signInMethods.includes("password");
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Link href="/settings" className="inline-flex items-center gap-1 self-start text-caption font-semibold text-primary hover:underline">
        <ArrowLeft aria-hidden className="size-4" /> Settings
      </Link>
      <h1 className="text-page-heading text-text-primary">Account</h1>

      <Card as="section" aria-labelledby="sign-in-heading">
        <h2 id="sign-in-heading" className="text-card-title text-text-primary">
          Sign-in
        </h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-caption text-text-secondary">Name</dt>
            <dd className="text-body text-text-primary">{`${profile.firstName} ${profile.lastName}`.trim()}</dd>
          </div>
          {account && (
            <>
              <div>
                <dt className="text-caption text-text-secondary">Email</dt>
                <dd className="flex flex-wrap items-center gap-2 text-body break-all text-text-primary">
                  {account.email}
                  {account.emailVerified ? <StatusBadge status="success">Verified</StatusBadge> : <StatusBadge status="warning">Not verified</StatusBadge>}
                </dd>
              </div>
              <div>
                <dt className="text-caption text-text-secondary">Signs in with</dt>
                <dd className="text-body text-text-primary">{account.signInMethods.map((m) => METHOD[m]).join(", ")}</dd>
              </div>
              <div>
                <dt className="text-caption text-text-secondary">Member since</dt>
                <dd className="text-body text-text-primary">
                  {new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: profile.timeZone }).format(new Date(account.createdAt))}
                </dd>
              </div>
            </>
          )}
        </dl>
        <p className="mt-4 text-caption text-text-secondary">
          To change your name or health details, go to{" "}
          <Link href="/profile" className="font-semibold text-primary hover:underline">
            Profile
          </Link>
          .
        </p>
      </Card>

      {hasPassword ? (
        <Card as="section" aria-labelledby="password-heading">
          <h2 id="password-heading" className="mb-4 text-card-title text-text-primary">
            Change password
          </h2>
          <ChangePasswordForm />
        </Card>
      ) : (
        <Card as="section" aria-labelledby="password-heading">
          <h2 id="password-heading" className="text-card-title text-text-primary">
            Password
          </h2>
          <p className="mt-1 text-body text-text-secondary">You sign in with {account?.signInMethods.map((m) => METHOD[m]).join(" or ")}, so there&apos;s no HealthMate password to change.</p>
        </Card>
      )}

      <Card as="section" aria-labelledby="session-heading" className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 id="session-heading" className="text-card-title text-text-primary">
            This device
          </h2>
          <p className="text-caption text-text-secondary">Signing out keeps your information in your account.</p>
        </div>
        <SignOutButton />
      </Card>
      <p className="text-caption text-text-secondary">
        To delete your account and all its data, go to{" "}
        <Link href="/settings#delete" className="font-semibold text-primary hover:underline">
          Settings › Delete account
        </Link>
        .
      </p>
    </div>
  );
}
