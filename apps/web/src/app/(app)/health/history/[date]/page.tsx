import type { MeasurementKind } from "@healthmate/shared-types";
import type { Metadata } from "next";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { SampleContentLabel } from "@/components/ui/content-labels";
import { Disclaimer } from "@/components/ui/disclaimer";
import { IconBadge } from "@/components/ui/icon-badge";
import { StateView } from "@/components/ui/state-view";
import { StatusBadge } from "@/components/ui/status-badge";
import { MEASUREMENT_ICON } from "@/features/health/metric-icons";
import { formatMetric, HEALTH_METRICS, trendLabel } from "@/features/health/metrics";
import { getHealthTrends, getMeta } from "@/lib/api/data";
import { buildDailyHistory, compareWithUsual, HISTORY_METRICS, shiftDay, type UsualComparison } from "@/lib/health-history";
import { unitFor } from "@/lib/display-prefs";
import { getDisplayPrefs } from "@/lib/display-prefs.server";

export const metadata: Metadata = { title: "Day in your health history" };
export const dynamic = "force-dynamic";

const LABEL: Partial<Record<MeasurementKind, string>> = {
  sleep: "Sleep",
  steps: "Steps",
  resting_heart_rate: "Resting heart rate",
  heart_rate: "Average heart rate",
  active_energy: "Active energy",
  weight: "Weight",
};

const BADGE: Record<UsualComparison, "success" | "info" | "neutral"> = { in_usual_range: "success", above_usual: "info", below_usual: "info", no_baseline: "neutral" };

/** One day of the person's health history, each reading next to their own usual. */
export default async function HealthDayPage({ params }: { params: Promise<{ date: string }> }) {
  const { units } = await getDisplayPrefs();
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00Z`))) notFound();
  const [{ trends, failed }, meta] = await Promise.all([getHealthTrends(90), getMeta()]);
  const history = buildDailyHistory(trends);
  const day = history.find((d) => d.date === date);
  const newest = history[0]?.date;
  const oldest = history.at(-1)?.date;
  const title = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  const previous = oldest && date > oldest ? shiftDay(date, -1) : null;
  const next = newest && date < newest ? shiftDay(date, 1) : null;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Link href="/health/history" className="inline-flex items-center gap-1 self-start text-caption font-semibold text-primary hover:underline">
        <ArrowLeft aria-hidden className="size-4" /> Daily history
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-page-heading text-text-primary">{title}</h1>
        <nav aria-label="Day" className="flex gap-2">
          {previous ? (
            <Link href={`/health/history/${previous}`} className="inline-flex items-center gap-1 rounded-pill px-3 py-1.5 text-caption font-semibold text-primary ring-1 ring-separator hover:bg-primary-soft">
              <ChevronLeft aria-hidden className="size-4" /> Previous day
            </Link>
          ) : null}
          {next ? (
            <Link href={`/health/history/${next}`} className="inline-flex items-center gap-1 rounded-pill px-3 py-1.5 text-caption font-semibold text-primary ring-1 ring-separator hover:bg-primary-soft">
              Next day <ChevronRight aria-hidden className="size-4" />
            </Link>
          ) : null}
        </nav>
      </div>
      {meta?.preview && <SampleContentLabel>Sample health data in Preview mode — not real readings.</SampleContentLabel>}

      {failed ? (
        <Card>
          <StateView state={failed.code === "network" ? "offline" : "error"} title={failed.code === "network" ? undefined : "This day couldn't load"} />
        </Card>
      ) : !day ? (
        <Card>
          <StateView state="empty" title="No readings on this day" description="Apple Health didn't sync anything for this day, and no readings were added." />
        </Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {HISTORY_METRICS.map((kind) => {
            const def = HEALTH_METRICS.find((m) => m.kind === kind)!;
            const value = day.values[kind];
            const { usual, comparison } = compareWithUsual(history, date, kind);
            return (
              <li key={kind}>
                <Link href={`/health/${kind}`} className="lift flex h-full items-start gap-3 rounded-lg bg-card p-4 shadow-card">
                  <IconBadge icon={MEASUREMENT_ICON[kind]} tone={def.tone} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-caption text-text-secondary">{LABEL[kind]}</span>
                    <span className="block text-metric text-text-primary tabular-nums">
                      {value !== undefined ? formatMetric(kind, value) : "—"}
                      {value !== undefined && unitFor(def.kind, units, def.unit) && <span className="ml-1 text-body font-medium text-text-secondary">{unitFor(def.kind, units, def.unit)}</span>}
                    </span>
                    {value === undefined ? (
                      <span className="text-caption text-text-secondary">Not recorded this day</span>
                    ) : (
                      <span className="mt-1 flex flex-wrap items-center gap-2 text-caption text-text-secondary">
                        <StatusBadge status={BADGE[comparison]}>{trendLabel(comparison)}</StatusBadge>
                        {usual !== null && (
                          <span>
                            Your usual {formatMetric(kind, usual)}
                            {unitFor(def.kind, units, def.unit) ? ` ${unitFor(def.kind, units, def.unit)}` : ""}
                          </span>
                        )}
                      </span>
                    )}
                  </span>
                  <ChevronRight aria-hidden className="mt-1 size-4 shrink-0 text-text-muted" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <Disclaimer>&ldquo;Your usual&rdquo; is your own average over the 30 days before. It describes your pattern, not a medical assessment.</Disclaimer>
    </div>
  );
}
