import type { Metadata } from "next";
import { ArrowLeft, CalendarDays, ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SampleContentLabel } from "@/components/ui/content-labels";
import { StateView } from "@/components/ui/state-view";
import { formatMetric } from "@/features/health/metrics";
import { getHealthTrends, getMeta } from "@/lib/api/data";
import { cn } from "@/lib/cn";
import { buildDailyHistory, dayLabel, groupByMonth } from "@/lib/health-history";
import { unitFor } from "@/lib/display-prefs";
import { getDisplayPrefs } from "@/lib/display-prefs.server";

export const metadata: Metadata = { title: "Daily health history" };
export const dynamic = "force-dynamic";

const RANGES = [30, 90] as const;

/**
 * The person's longitudinal record: one row per day with that day's readings.
 * (Phase 1 shows the Preview sample; Phase 2 fills it from the stored history.)
 */
export default async function HealthHistoryPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const { units } = await getDisplayPrefs();
  const { days: raw } = await searchParams;
  const days = RANGES.find((d) => String(d) === raw) ?? 30;
  const [{ trends, failed }, meta] = await Promise.all([getHealthTrends(days), getMeta()]);
  const history = buildDailyHistory(trends);
  const today = history[0]?.date;

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <Link href="/health" className="inline-flex items-center gap-1 self-start text-caption font-semibold text-primary hover:underline">
        <ArrowLeft aria-hidden className="size-4" /> Health
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-page-heading text-text-primary">Daily health history</h1>
          <p className="mt-1 text-body text-text-secondary">Each day&apos;s readings, kept as part of your long-term health record.</p>
        </div>
        <nav aria-label="Period" className="inline-flex gap-1 rounded-pill bg-card-muted p-1 ring-1 ring-separator">
          {RANGES.map((d) => (
            <Link
              key={d}
              href={`/health/history?days=${d}`}
              aria-current={d === days ? "page" : undefined}
              className={cn("rounded-pill px-4 py-1.5 text-caption font-semibold", d === days ? "bg-card text-primary shadow-card" : "text-text-secondary hover:text-text-primary")}
            >
              {d} days
            </Link>
          ))}
        </nav>
      </div>
      {meta?.preview && <SampleContentLabel>Sample health history in Preview mode — not real readings.</SampleContentLabel>}

      {failed ? (
        <Card>
          <StateView state={failed.code === "network" ? "offline" : "error"} title={failed.code === "network" ? undefined : "Your health history couldn't load"} />
        </Card>
      ) : history.length === 0 ? (
        <Card>
          <StateView
            state="empty"
            icon={<CalendarDays />}
            title="No days recorded yet"
            description="When Apple Health syncs or you add a reading, that day is saved here."
            action={
              <ButtonLink href="/health/add" size="sm">
                <Plus aria-hidden /> Add a reading
              </ButtonLink>
            }
          />
        </Card>
      ) : (
        groupByMonth(history).map((group) => (
          <Card as="section" key={group.month} aria-labelledby={`month-${group.month}`} padded={false}>
            <h2 id={`month-${group.month}`} className="px-5 pt-4 pb-2 text-caption font-semibold tracking-wide text-text-secondary uppercase">
              {group.month}
            </h2>
            <ul className="divide-y divide-separator">
              {group.days.map((day) => (
                <li key={day.date}>
                  <Link href={`/health/history/${day.date}`} className="flex items-center gap-4 px-5 py-3 hover:bg-card-muted">
                    <span className="w-28 shrink-0">
                      <span className="block text-body font-semibold text-text-primary">{dayLabel(day.date, today)}</span>
                      {day.date === today && <span className="text-xs text-text-secondary">In progress</span>}
                    </span>
                    <dl className="grid min-w-0 flex-1 grid-cols-2 gap-x-4 gap-y-1 text-caption sm:grid-cols-4">
                      <Value label="Sleep" value={day.values.sleep !== undefined ? formatMetric("sleep", day.values.sleep) : undefined} />
                      <Value label="Steps" value={day.values.steps !== undefined ? formatMetric("steps", day.values.steps) : undefined} />
                      <Value label="Resting HR" value={day.values.resting_heart_rate !== undefined ? `${formatMetric("resting_heart_rate", day.values.resting_heart_rate)} bpm` : undefined} />
                      <Value label="Weight" value={day.values.weight !== undefined ? `${formatMetric("weight", day.values.weight)} ${unitFor("weight", units)}` : undefined} />
                    </dl>
                    <ChevronRight aria-hidden className="size-4 shrink-0 text-text-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ))
      )}
    </div>
  );
}

function Value({ label, value }: { label: string; value?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-text-secondary">{label}</dt>
      <dd className={cn("tabular-nums", value ? "font-semibold text-text-primary" : "text-text-muted")}>{value ?? "—"}</dd>
    </div>
  );
}
