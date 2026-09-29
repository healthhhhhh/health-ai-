import type { TrendResponse } from "@healthmate/shared-types";
import type { Metadata } from "next";
import { HeartPulse } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ChartCard } from "@/components/ui/chart-card";
import { Disclaimer } from "@/components/ui/disclaimer";
import { EmptyState } from "@/components/ui/empty-state";
import { formatMetric, HEALTH_METRICS, trendLabel } from "@/features/health/metrics";
import { TrendChart } from "@/features/health/trend-chart";
import { api } from "@/lib/api/server";
import { cn } from "@/lib/cn";
import { trendOf } from "@/lib/home";

export const metadata: Metadata = { title: "Health Dashboard" };

export default async function HealthPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const { days: raw } = await searchParams;
  const days = raw === "30" ? 30 : 7;
  const trends = await Promise.all(HEALTH_METRICS.map((m) => api<TrendResponse>(`health-data/trends?kind=${m.kind}&days=${days}`).catch(() => null)));
  const withData = HEALTH_METRICS.map((m, i) => ({ def: m, trend: trends[i] })).filter((x) => x.trend && x.trend.points.length > 0);

  return (
    <>
      <PageHeader
        title="Health Dashboard"
        description="Your synced measurements over time, compared with your own earlier days."
        actions={
          <nav aria-label="Period" className="inline-flex gap-1 rounded-pill bg-card-muted p-1 ring-1 ring-separator">
            {[7, 30].map((d) => (
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
        }
      />
      {withData.length === 0 ? (
        <Card>
          <EmptyState
            icon={<HeartPulse />}
            title="No synced health data yet"
            description="Connect Apple Health in the HealthMate iPhone app and choose Sync to my account. Your steps, heart rate, sleep and weight will appear here."
          />
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
          {withData.map(({ def, trend }) => (
            <ChartCard
              key={def.kind}
              title={def.title}
              value={trend!.average != null ? formatMetric(def.kind, trend!.average) : "—"}
              unit={def.unit}
              context={`${def.summary} · ${trendLabel(trendOf(trend!))}`}
              href={`/health/${def.kind}`}
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
      )}
      <Disclaimer className="mt-6">Trends compare your recent days with your own earlier days. They&apos;re context, not a medical assessment.</Disclaimer>
    </>
  );
}
