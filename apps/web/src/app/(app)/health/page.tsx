import type { ConsentRecord, MeasurementKind } from "@healthmate/shared-types";
import type { Metadata } from "next";
import { CalendarDays, ChevronRight, HeartPulse, Plus } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ChartCard } from "@/components/ui/chart-card";
import { SampleContentLabel } from "@/components/ui/content-labels";
import { Disclaimer } from "@/components/ui/disclaimer";
import { MetricCard } from "@/components/ui/metric-card";
import { StateView } from "@/components/ui/state-view";
import { AppleHealthStatus } from "@/features/health/apple-health-status";
import { MEASUREMENT_ICON } from "@/features/health/metric-icons";
import { formatMetric, HEALTH_METRICS, trendLabel } from "@/features/health/metrics";
import { TrendChart } from "@/features/health/trend-chart";
import { getHealthConnection, getHealthTrends, getMeta } from "@/lib/api/data";
import { api } from "@/lib/api/server";
import { cn } from "@/lib/cn";
import { buildDailyHistory, compareWithUsual, dayLabel } from "@/lib/health-history";
import { trendOf } from "@/lib/home";

export const metadata: Metadata = { title: "Health Dashboard" };
export const dynamic = "force-dynamic";

const RANGES = [7, 30, 90] as const;

/** Today's snapshot, in the order people usually check them. */
const TODAY: { kind: MeasurementKind; label: string }[] = [
  { kind: "sleep", label: "Sleep last night" },
  { kind: "steps", label: "Steps today" },
  { kind: "resting_heart_rate", label: "Resting heart rate" },
  { kind: "active_energy", label: "Active energy today" },
  { kind: "weight", label: "Weight" },
];

export default async function HealthPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const { days: raw } = await searchParams;
  const days = RANGES.find((d) => String(d) === raw) ?? 7;
  const [period, recent, connection, consents, meta] = await Promise.all([
    getHealthTrends(days),
    // The last 90 days give each day's "usual" for the snapshot and the history preview.
    getHealthTrends(90),
    getHealthConnection(),
    api<ConsentRecord[]>("me/consents").catch(() => []),
    getMeta(),
  ]);
  const now = new Date();
  const sample = Boolean(meta?.preview);
  const syncConsent = consents.some((c) => c.kind === "health_data_sync" && c.granted);
  const history = buildDailyHistory(recent.trends);
  const today = history[0];
  const withData = HEALTH_METRICS.map((def) => ({ def, trend: period.trends[def.kind] })).filter((x) => x.trend && x.trend.points.length > 0);

  const header = (
    <PageHeader
      title="Health"
      description="Your measurements over time, compared with your own earlier days."
      actions={
        <>
          <nav aria-label="Period" className="inline-flex gap-1 rounded-pill bg-card-muted p-1 ring-1 ring-separator">
            {RANGES.map((d) => (
              <Link
                key={d}
                href={`/health?days=${d}`}
                aria-current={d === days ? "page" : undefined}
                className={cn("rounded-pill px-4 py-1.5 text-caption font-semibold", d === days ? "bg-card text-primary shadow-card" : "text-text-secondary hover:text-text-primary")}
              >
                {d} days
              </Link>
            ))}
          </nav>
          <ButtonLink href="/health/add" variant="secondary" size="sm" className="h-10">
            <Plus aria-hidden /> Add a reading
          </ButtonLink>
        </>
      }
    />
  );

  if (period.failed) {
    const offline = period.failed.code === "network";
    return (
      <>
        {header}
        <Card>
          <StateView
            state={offline ? "offline" : "error"}
            title={offline ? undefined : "Your health data couldn't load"}
            action={
              <a href={`/health?days=${days}`} className="text-caption font-semibold text-primary hover:underline">
                Try again
              </a>
            }
          />
        </Card>
      </>
    );
  }

  return (
    <>
      {header}
      <div className="flex flex-col gap-6">
        <AppleHealthStatus connection={connection} syncConsent={syncConsent} now={now} />

        {withData.length === 0 ? (
          <Card>
            <StateView
              state="empty"
              icon={<HeartPulse />}
              title={`No health data in the last ${days} days`}
              description="Connect Apple Health in the HealthMate iPhone app, or add a reading yourself. Each day you record becomes part of your health history."
              action={
                <ButtonLink href="/health/add" size="sm">
                  <Plus aria-hidden /> Add a reading
                </ButtonLink>
              }
            />
          </Card>
        ) : (
          <>
            {today && (
              <section aria-labelledby="today-heading" className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 id="today-heading" className="text-section-heading text-text-primary">
                    Today
                  </h2>
                  {sample && <SampleContentLabel className="py-1.5">Sample health data in Preview mode — not real readings.</SampleContentLabel>}
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 [&>*]:min-w-0">
                  {TODAY.map(({ kind, label }) => {
                    const value = today.values[kind];
                    const def = HEALTH_METRICS.find((m) => m.kind === kind)!;
                    const { comparison } = compareWithUsual(history, today.date, kind);
                    return (
                      <MetricCard
                        key={kind}
                        label={label}
                        value={value !== undefined ? formatMetric(kind, value) : "—"}
                        unit={value !== undefined ? def.unit : undefined}
                        context={value === undefined ? "Not recorded yet" : kind === "steps" || kind === "active_energy" ? "So far today" : trendLabel(comparison)}
                        icon={MEASUREMENT_ICON[kind]}
                        tone={def.tone}
                        href={`/health/${kind}`}
                        layout="stacked"
                      />
                    );
                  })}
                </div>
              </section>
            )}

            <section aria-labelledby="trends-heading" className="flex flex-col gap-3">
              <h2 id="trends-heading" className="text-section-heading text-text-primary">
                Last {days} days
              </h2>
              <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
                {withData.map(({ def, trend }) => (
                  <ChartCard
                    key={def.kind}
                    title={def.title}
                    icon={MEASUREMENT_ICON[def.kind]}
                    value={trend!.average != null ? formatMetric(def.kind, trend!.average) : "—"}
                    unit={def.unit}
                    context={`${def.summary} · ${trendLabel(trendOf(trend!))}`}
                    href={`/health/${def.kind}?days=${days}`}
                  >
                    <TrendChart
                      label={def.title}
                      kind={def.chart}
                      tone={def.tone}
                      points={trend!.points.map((p) => ({ date: p.date, value: p.value }))}
                      baseline={trend!.previousAverage}
                      metric={def.kind}
                    />
                  </ChartCard>
                ))}
              </div>
            </section>

            <Card as="section" aria-labelledby="history-heading">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 id="history-heading" className="text-card-title text-text-primary">
                    Daily history
                  </h2>
                  <p className="text-caption text-text-secondary">Every day you record is kept in your health history.</p>
                </div>
                <ButtonLink href="/health/history" variant="soft" size="sm">
                  <CalendarDays aria-hidden /> See all days
                </ButtonLink>
              </div>
              <ul className="divide-y divide-separator">
                {history.slice(0, 7).map((day) => (
                  <li key={day.date}>
                    <Link href={`/health/history/${day.date}`} className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2.5 hover:bg-card-muted">
                      <span className="w-28 shrink-0 text-body font-semibold text-text-primary">{dayLabel(day.date, today?.date)}</span>
                      <span className="flex min-w-0 flex-1 flex-wrap gap-x-4 gap-y-0.5 text-caption text-text-secondary tabular-nums">
                        {day.values.sleep !== undefined && <span>Sleep {formatMetric("sleep", day.values.sleep)}</span>}
                        {day.values.steps !== undefined && <span>{formatMetric("steps", day.values.steps)} steps</span>}
                        {day.values.resting_heart_rate !== undefined && <span>Resting {formatMetric("resting_heart_rate", day.values.resting_heart_rate)} bpm</span>}
                        {day.values.weight !== undefined && <span>{formatMetric("weight", day.values.weight)} kg</span>}
                      </span>
                      <ChevronRight aria-hidden className="size-4 shrink-0 text-text-muted" />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          </>
        )}
      </div>
      <Disclaimer className="mt-6">Trends compare your recent days with your own earlier days. They&apos;re context, not a medical assessment.</Disclaimer>
    </>
  );
}

