import type { TimelineEventRecord, TimelinePage } from "@healthmate/shared-types";
import type { Metadata } from "next";
import { ArrowLeft, ExternalLink } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IconBadge } from "@/components/ui/icon-badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { ACTIVITY_META } from "@/features/home/activity-meta";
import { DeleteEntryButton } from "@/features/timeline/delete-entry-button";
import { EditEntryForm } from "@/features/timeline/edit-entry-form";
import { getProfile } from "@/lib/api/data";
import { api } from "@/lib/api/server";
import { activityKind } from "@/lib/home";
import { timelineHref } from "@/lib/links";
import { entryDetails, isEditable, TIMELINE_SOURCE, TIMELINE_TYPE } from "@/lib/timeline";

export const metadata: Metadata = { title: "Timeline entry" };
export const dynamic = "force-dynamic";

const OPEN_LABEL: Partial<Record<TimelineEventRecord["eventType"], string>> = {
  report: "Open the report",
  image: "Open the photo check",
  chat: "Open the conversation",
  appointment: "Open the appointment",
  measurement: "See this reading over time",
  medication: "Open your plan",
};

/** Finds an entry by paging through the timeline (the API lists entries; there's no single-entry read). */
async function findEntry(id: string): Promise<TimelineEventRecord | null> {
  let before: string | null = null;
  for (let pageCount = 0; pageCount < 5; pageCount++) {
    const page: TimelinePage = await api<TimelinePage>(`timeline?limit=100${before ? `&before=${encodeURIComponent(before)}` : ""}`);
    const entry = page.events.find((e) => e.id === id);
    if (entry) return entry;
    if (!page.nextCursor) return null;
    before = page.nextCursor;
  }
  return null;
}

export default async function TimelineEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [entry, { profile }] = await Promise.all([findEntry(id), getProfile()]);
  if (!entry) notFound();
  const meta = ACTIVITY_META[activityKind(entry.eventType)];
  const when = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: profile.timeZone }).format(
    new Date(entry.occurredAt),
  );
  const details = entryDetails(entry);
  const related = timelineHref(entry);
  const severity = typeof entry.payload?.severity === "number" ? entry.payload.severity : null;
  const editable = isEditable(entry);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Link href="/timeline" className="inline-flex items-center gap-1 self-start text-caption font-semibold text-primary hover:underline">
        <ArrowLeft aria-hidden className="size-4" /> Timeline
      </Link>
      <div className="flex items-start gap-4">
        <IconBadge icon={meta.icon} tone={meta.tone} size="lg" />
        <div className="min-w-0">
          <p className="text-caption font-semibold text-text-secondary">{TIMELINE_TYPE[entry.eventType]}</p>
          <h1 className="text-page-heading text-text-primary">{entry.title}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-body text-text-secondary">
            <time dateTime={entry.occurredAt}>{when}</time>
            <StatusBadge status={entry.sourceType === "ai_summary" ? "info" : "neutral"}>{TIMELINE_SOURCE[entry.sourceType]}</StatusBadge>
          </p>
        </div>
      </div>

      {(details || severity !== null) && (
        <Card as="section" aria-label="Details" className="flex flex-col gap-3">
          {severity !== null && (
            <p className="text-body text-text-primary">
              <span className="text-caption font-semibold text-text-secondary">How strong (your rating) </span>
              {severity} of 5
            </p>
          )}
          {details && (
            <div>
              <p className="text-caption font-semibold text-text-secondary">Details</p>
              <p className="mt-1 text-body whitespace-pre-line text-text-primary">{details}</p>
            </div>
          )}
        </Card>
      )}

      {related !== "/timeline" && (
        <Card as="section" aria-label="Related" className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-body text-text-secondary">This entry comes from something else in HealthMate.</p>
          <ButtonLink href={related} variant="soft">
            <ExternalLink aria-hidden /> {OPEN_LABEL[entry.eventType] ?? "Open"}
          </ButtonLink>
        </Card>
      )}

      {editable ? (
        <Card as="section" aria-label="Edit or delete" className="flex flex-wrap items-start gap-3">
          <EditEntryForm entry={entry} />
          <DeleteEntryButton id={entry.id} title={entry.title} redirectTo="/timeline" compact={false} />
        </Card>
      ) : (
        <p className="text-caption text-text-secondary">
          {entry.sourceType === "user_entered" ? "This entry is managed where it was created." : `${TIMELINE_SOURCE[entry.sourceType]} — it can't be edited here.`}
        </p>
      )}
    </div>
  );
}
