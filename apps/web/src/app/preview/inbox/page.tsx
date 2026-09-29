import type { Metadata } from "next";
import { Inbox, Mail } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Logo } from "@/components/illustrations/logo";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { isPreviewMode } from "@/lib/preview/mode";
import { publicApi } from "@/lib/api/server";
import type { PreviewEmail } from "@/lib/preview/store";

export const metadata: Metadata = { title: "Preview inbox" };
export const dynamic = "force-dynamic";

/**
 * Preview mode only: the emails HealthMate would have sent (verification,
 * password reset), so those flows can be completed without a mail server.
 */
export default async function PreviewInboxPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  if (!isPreviewMode()) notFound();
  const { email = "" } = await searchParams;
  const emails = email ? (await publicApi<{ emails: PreviewEmail[] }>(`preview/inbox?email=${encodeURIComponent(email)}`)).emails : [];
  return (
    <main className="bg-app-gradient flex min-h-dvh justify-center px-6 py-12">
      <div className="w-full max-w-lg">
        <Link href="/" className="mb-8 flex justify-center text-xl" aria-label="HealthMate welcome">
          <Logo size={32} />
        </Link>
        <div className="rounded-xl bg-card p-7 shadow-card">
          <h1 className="flex items-center gap-2 text-page-heading text-text-primary">
            <Inbox aria-hidden className="size-6 text-primary" /> Preview inbox
          </h1>
          <p className="mt-1 mb-6 text-body text-text-secondary">In Preview mode no email is really sent. Messages to any address appear here instead.</p>
          <form className="flex items-end gap-2">
            <div className="flex-1">
              <Input label="Email address" name="email" type="email" defaultValue={email} autoComplete="email" />
            </div>
            <Button type="submit">Show</Button>
          </form>
          {email && (
            <ul className="mt-6 flex flex-col gap-3">
              {emails.length === 0 && <li className="rounded-md bg-card-muted p-4 text-body text-text-secondary">No messages for {email} yet.</li>}
              {emails.map((m) => (
                <li key={m.id} className="rounded-lg p-4 ring-1 ring-separator">
                  <p className="flex items-center gap-2 text-body font-semibold text-text-primary">
                    <Mail aria-hidden className="size-4 text-primary" /> {m.subject}
                  </p>
                  <p className="mt-1 text-caption text-text-secondary">{m.body}</p>
                  {/* A plain link: prefetching would use up the one-time token. */}
                  <a href={m.link} className="mt-3 inline-flex h-9 items-center rounded-pill bg-primary-fill px-4 text-caption font-semibold text-on-primary hover:opacity-90">
                    {m.linkLabel}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  );
}
