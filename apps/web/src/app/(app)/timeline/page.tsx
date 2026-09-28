import type { TimelinePage } from "@healthmate/shared-types";
import type { Metadata } from "next";
import { History } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconBadge } from "@/components/ui/icon-badge";
import { ACTIVITY_META } from "@/features/home/activity-meta";
import { AddEntryForm } from "@/features/timeline/add-entry-form";
import { DeleteEntryButton } from "@/features/timeline/delete-entry-button";
import { getProfile } from "@/lib/api/data";
import { api } from "@/lib/api/server";
import { activityKind } from "@/lib/home";

export const metadata: Metadata = { title: "Health Timeline" };

const SOURCE: Record<string, string> = {
  user_entered: "Added by you",
  device: "From a device",
  document: "From a report",
  clinician: "From your clinician",
  ai_summary: "AI-generated summary",
};

export default async function TimelinePage({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  const { before } = await searchParams;
  const [page, { profile }] = await Promise.all([api<TimelinePage>(`timeline${before ? `?before=${encodeURIComponent(before)}` : ""}`), getProfile()]);
  const day = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: profile.timeZone });
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: profile.timeZone });
  const groups = new Map<string, TimelinePage["events"]>();
  for (const e of page.events) {
    const key = day.format(new Date(e.occurredAt));
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }

  return (
    <>
      <PageHeader title="Health Timeline" description="Reports, conversations, symptoms and notes in order, each with where it came from." />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px] [&>*]:min-w-0">
        <div className="flex flex-col gap-6">
          {page.events.length === 0 ? (
            <Card>
              <EmptyState icon={<History />} title="Your timeline is empty" description="Reports you upload, conversations and anything you add here will appear in order." />
            </Card>
          ) : (
            [...groups.entries()].map(([label, events]) => (
              <Card as="section" key={label} aria-label={label}>
                <h2 className="mb-3 text-card-title text-text-primary">{label}</h2>
                <ul className="flex flex-col divide-y divide-separator">
                  {events.map((e) => {
                    const meta = ACTIVITY_META[activityKind(e.eventType)];
                    return (
                      <li key={e.id} className="flex items-center gap-3 py-2.5">
                        <IconBadge icon={meta.icon} tone={meta.tone} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-body text-text-primary">{e.title}</p>
                          <p className="text-caption text-text-secondary">{SOURCE[e.sourceType] ?? e.sourceType}</p>
                        </div>
                        <time dateTime={e.occurredAt} className="text-caption text-text-secondary">
                          {time.format(new Date(e.occurredAt))}
                        </time>
                        {e.sourceType === "user_entered" && e.eventType !== "chat" && <DeleteEntryButton id={e.id} title={e.title} />}
                      </li>
                    );
                  })}
                </ul>
              </Card>
            ))
          )}
          {page.nextCursor && (
            <Link href={`/timeline?before=${encodeURIComponent(page.nextCursor)}`} className="self-center text-caption font-semibold text-primary hover:underline">
              Show older entries
            </Link>
          )}
        </div>
        <Card as="section" aria-labelledby="add-entry" className="h-fit">
          <h2 id="add-entry" className="mb-4 text-card-title text-text-primary">
            Add to your timeline
          </h2>
          <AddEntryForm />
        </Card>
      </div>
    </>
  );
}
