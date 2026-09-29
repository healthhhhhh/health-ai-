import type { LatestMeasurement, MeasurementKind, TrendResponse } from "@healthmate/shared-types";
import type { Metadata } from "next";
import { ArrowLeft, ChevronRight, HeartPulse, MessageCircle } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SourceBadge } from "@/components/ui/content-labels";
import { Disclaimer } from "@/components/ui/disclaimer";
import { StateView } from "@/components/ui/state-view";
import { formatMetric, HEALTH_METRICS, trendLabel } from "@/features/health/metrics";
import { TrendChart } from "@/features/health/trend-chart";
import { getMeta } from "@/lib/api/data";
import { api, ApiError } from "@/lib/api/server";
import { cn } from "@/lib/cn";
import { formatRelative } from "@/lib/format";
import { dayLabel } from "@/lib/health-history";
import { trendOf } from "@/lib/home";
import { READING_TYPES } from "@/features/health/reading-types";

const RANGES = [7, 30, 90] as const;

export async function generateMetadata({ params }: { params: Promise<{ kind: string }> }): Promise<Metadata> {
  const { kind } = await params;
  return { title: HEALTH_METRICS.find((m) => m.kind === kind)?.title ?? "Health" };
}

/** One measurement over time, compared with the person's own earlier days. */
export default async function MetricDetailPage({ params, searchParams }: { params: Promise<{ kind: string }>; searchParams: Promise<{ days?: string }> }) {
  const [{ kind }, { days: raw }] = await Promise.all([params, searchParams]);
  const def = HEALTH_METRICS.find((m) => m.kind === kind);
  if (!def) notFound();
  const days = RANGES.find((d) => String(d) === raw) ?? 7;
  const [trend, latest, meta] = await Promise.all([
    api<TrendResponse>(`health-data/trends?kind=${def.kind}&days=${days}`).catch((error) => {
      if (error instanceof ApiError && error.status !== 401) return error;
      throw error;
    }),
    api<LatestMeasurement[]>("health-data/latest").catch(() => []),
    getMeta(),
  ]);
  const last = latest.find((m) => m.kind === (def.kind as MeasurementKind));
  const values = trend instanceof ApiError ? [] : trend.points.map((p) => p.value);
  const sample = Boolean(meta?.preview);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <Link href="/health" className="inline-flex items-center gap-1 self-start text-caption font-semibold text-primary hover:underline">
        <ArrowLeft aria-hidden className="size-4" /> Health
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-page-heading text-text-primary">{def.title}</h1>
          {last && (
            <p className="mt-1 flex flex-wrap items-center gap-2 text-body text-text-secondary">
              Latest {formatMetric(def.kind, last.value)}
              {def.unit ? ` ${def.unit}` : ""} · {formatRelative(last.recordedAt, new Date())}
              <SourceBadge source={sample ? "sample" : last.source === "apple_health" ? "apple_health" : "user_reported"} />
            </p>
          )}
        </div>
        <nav aria-label="Period" className="inline-flex gap-1 rounded-pill bg-card-muted p-1 ring-1 ring-separator">
          {RANGES.map((d) => (
            <Link
              key={d}
              href={`/health/${def.kind}?days=${d}`}
              aria-current={d === days ? "page" : undefined}
              className={cn("rounded-pill px-4 py-1.5 text-caption font-semibold", d === days ? "bg-card text-primary shadow-card" : "text-text-secondary hover:text-text-primary")}
            >
              {d} days
            </Link>
          ))}
        </nav>
      </div>

      {trend instanceof ApiError ? (
        <Card>
          <StateView state={trend.code === "network" ? "offline" : "error"} title={trend.code === "network" ? undefined : `Couldn't load ${def.title.toLowerCase()}`} />
        </Card>
      ) : trend.points.length === 0 ? (
        <Card>
          <StateView
            state="empty"
            icon={<HeartPulse />}
            title={`No ${def.title.toLowerCase()} in the last ${days} days`}
            description="Connect Apple Health in the HealthMate iPhone app and choose Sync to my account. New readings appear here."
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label={def.summary} value={trend.average != null ? formatMetric(def.kind, trend.average) : "—"} unit={def.unit} />
            <Stat label="Lowest day" value={formatMetric(def.kind, Math.min(...values))} unit={def.unit} />
            <Stat label="Highest day" value={formatMetric(def.kind, Math.max(...values))} unit={def.unit} />
            <Stat label={`Previous ${days} days`} value={trend.previousAverage != null ? formatMetric(def.kind, trend.previousAverage) : "—"} unit={def.unit} />
          </div>
          <Card as="section" aria-labelledby="trend-heading">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 id="trend-heading" className="text-card-title text-text-primary">
                Last {days} days
              </h2>
              <p className="text-caption font-semibold text-text-secondary">{trendLabel(trendOf(trend))}</p>
            </div>
            <TrendChart
              label={def.title}
              kind={def.chart}
              tone={def.tone}
              points={trend.points.map((p) => ({ date: p.date, value: p.value }))}
              baseline={trend.previousAverage}
              metric={def.kind}
            />
            <p className="mt-3 text-caption text-text-secondary">
              The dashed line is your average for the {days} days before. &ldquo;Usual range&rdquo; means within 10% of that — it describes your own pattern, not a medical
              assessment.
            </p>
          </Card>
        </>
      )}

      {!(trend instanceof ApiError) && trend.points.length > 0 && (
        <Card as="section" aria-labelledby="days-heading">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 id="days-heading" className="text-card-title text-text-primary">
              Day by day
            </h2>
            {READING_TYPES.some((t) => t.kind === def.kind) && (
              <Link href={`/health/add?kind=${def.kind}`} className="text-caption font-semibold text-primary hover:underline">
                Add a reading
              </Link>
            )}
          </div>
          <ul className="divide-y divide-separator">
            {[...trend.points].reverse().map((p) => (
              <li key={p.date}>
                <Link href={`/health/history/${p.date}`} className="-mx-2 flex items-center justify-between gap-3 rounded-md px-2 py-2 hover:bg-card-muted">
                  <span className="text-body text-text-primary">{dayLabel(p.date, trend.points.at(-1)!.date)}</span>
                  <span className="flex items-center gap-2 text-body font-semibold text-text-primary tabular-nums">
                    {formatMetric(def.kind, p.value)}
                    {def.unit && <span className="text-caption font-medium text-text-secondary">{def.unit}</span>}
                    <ChevronRight aria-hidden className="size-4 text-text-muted" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card as="section" aria-labelledby="ask-heading" className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 id="ask-heading" className="text-card-title text-text-primary">
            Questions about your {def.title.toLowerCase()}?
          </h2>
          <p className="text-caption text-text-secondary">The AI Health Assistant can explain what you&apos;re seeing and what to ask your clinician.</p>
        </div>
        <ButtonLink href={`/chat?q=${encodeURIComponent(`Help me understand my ${def.title.toLowerCase()} over the last ${days} days.`)}`} variant="soft">
          <MessageCircle aria-hidden /> Ask the assistant
        </ButtonLink>
      </Card>
      <Disclaimer>Trends compare your recent days with your own earlier days. They&apos;re context, not a diagnosis.</Disclaimer>
    </div>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="rounded-lg bg-card p-4 shadow-card">
      <p className="text-caption text-text-secondary">{label}</p>
      <p className="mt-1 text-section-heading text-text-primary tabular-nums">
        {value}
        {unit && <span className="ml-1 text-caption font-medium text-text-secondary">{unit}</span>}
      </p>
    </div>
  );
}
