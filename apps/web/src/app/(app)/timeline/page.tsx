import type { TimelinePage } from "@healthmate/shared-types";
import type { Metadata } from "next";
import { ChevronRight, History } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { IconBadge } from "@/components/ui/icon-badge";
import { StateView } from "@/components/ui/state-view";
import { ACTIVITY_META } from "@/features/home/activity-meta";
import { AddEntryForm } from "@/features/timeline/add-entry-form";
import { getProfile } from "@/lib/api/data";
import { api, ApiError } from "@/lib/api/server";
import { cn } from "@/lib/cn";
import { activityKind } from "@/lib/home";
import { shiftDay } from "@/lib/health-history";
import { dayIn } from "@/lib/plan";
import { entryDetails, TIMELINE_FILTERS, TIMELINE_SOURCE, timelineFilter } from "@/lib/timeline";

export const metadata: Metadata = { title: "Health Timeline" };
export const dynamic = "force-dynamic";

export default async function TimelinePageView({ searchParams }: { searchParams: Promise<{ before?: string; show?: string }> }) {
  const { before, show } = await searchParams;
  const filter = timelineFilter(show);
  const query = new URLSearchParams();
  if (before) query.set("before", before);
  if (filter.types.length) query.set("types", filter.types.join(","));
  const [page, { profile }] = await Promise.all([
    api<TimelinePage>(`timeline${query.size ? `?${query}` : ""}`).catch((error) => {
      if (error instanceof ApiError && error.status !== 401) return error;
      throw error;
    }),
    getProfile(),
  ]);
  const tz = profile.timeZone;
  const today = dayIn(new Date(), tz);
  const yesterday = shiftDay(today, -1);
  const dayName = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: tz });
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });
  const label = (iso: string) => {
    const key = dayIn(new Date(iso), tz);
    return key === today ? "Today" : key === yesterday ? "Yesterday" : dayName.format(new Date(iso));
  };
  const groups = new Map<string, TimelinePage["events"]>();
  if (!(page instanceof ApiError)) {
    for (const e of page.events) groups.set(label(e.occurredAt), [...(groups.get(label(e.occurredAt)) ?? []), e]);
  }
  const href = (id: string) => (id === "all" ? "/timeline" : `/timeline?show=${id}`);

  return (
    <>
      <PageHeader title="Health Timeline" description="Reports, conversations, symptoms, readings and notes in order, each with where it came from." />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px] [&>*]:min-w-0">
        <div className="flex flex-col gap-4">
          <nav aria-label="Show" className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
            {TIMELINE_FILTERS.map((f) => (
              <Link
                key={f.id}
                href={href(f.id)}
                aria-current={f.id === filter.id ? "page" : undefined}
                className={cn(
                  "inline-flex h-9 shrink-0 items-center rounded-pill px-4 text-caption font-semibold transition-colors",
                  f.id === filter.id ? "bg-primary-fill text-on-primary shadow-raised" : "bg-card text-text-secondary ring-1 ring-separator hover:text-text-primary",
                )}
              >
                {f.label}
              </Link>
            ))}
          </nav>

          {page instanceof ApiError ? (
            <Card>
              <StateView
                state={page.code === "network" ? "offline" : "error"}
                title={page.code === "network" ? undefined : "Your timeline couldn't load"}
                action={
                  <a href={href(filter.id)} className="text-caption font-semibold text-primary hover:underline">
                    Try again
                  </a>
                }
              />
            </Card>
          ) : page.events.length === 0 ? (
            <Card>
              <StateView
                state="empty"
                icon={<History />}
                title={filter.id === "all" ? "Your timeline is empty" : `No ${filter.label.toLowerCase()} yet`}
                description={filter.empty}
                action={
                  filter.id !== "all" ? (
                    <Link href="/timeline" className="text-caption font-semibold text-primary hover:underline">
                      Show everything
                    </Link>
                  ) : undefined
                }
              />
            </Card>
          ) : (
            [...groups.entries()].map(([day, events]) => (
              <Card as="section" key={day} aria-label={day}>
                <h2 className="mb-2 text-card-title text-text-primary">{day}</h2>
                <ul className="flex flex-col divide-y divide-separator">
                  {events.map((e) => {
                    const meta = ACTIVITY_META[activityKind(e.eventType)];
                    const details = entryDetails(e);
                    return (
                      <li key={e.id}>
                        <Link href={`/timeline/${e.id}`} className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2.5 hover:bg-card-muted">
                          <IconBadge icon={meta.icon} tone={meta.tone} size="sm" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-body text-text-primary">{e.title}</p>
                            <p className="truncate text-caption text-text-secondary">
                              {TIMELINE_SOURCE[e.sourceType] ?? e.sourceType}
                              {details ? ` · ${details}` : ""}
                            </p>
                          </div>
                          <time dateTime={e.occurredAt} className="shrink-0 text-caption text-text-secondary tabular-nums">
                            {time.format(new Date(e.occurredAt))}
                          </time>
                          <ChevronRight aria-hidden className="size-4 shrink-0 text-text-muted" />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            ))
          )}
          {!(page instanceof ApiError) && page.nextCursor && (
            <Link
              href={`/timeline?${new URLSearchParams({ ...(filter.id !== "all" ? { show: filter.id } : {}), before: page.nextCursor })}`}
              className="self-center text-caption font-semibold text-primary hover:underline"
            >
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
