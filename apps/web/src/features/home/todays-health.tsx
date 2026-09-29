import type { HealthMetric } from "@healthmate/shared-types";
import { MetricCard } from "@/components/ui/metric-card";
import { SectionHeader } from "@/components/ui/section-header";
import { EmptyState } from "@/components/ui/empty-state";
import { HeartPulse } from "lucide-react";
import { presentMetric } from "@/lib/metrics";
import { metricHref } from "@/lib/links";
import { METRIC_ICON } from "./metric-icons";
import { SectionError } from "./section-error";

export function TodaysHealth({ metrics, failed }: { metrics: HealthMetric[]; failed?: boolean }) {
  return (
    <section aria-labelledby="todays-health">
      <SectionHeader id="todays-health" title="Today's Health" actionLabel="See All" actionHref="/health" />
      {failed ? (
        <div className="rounded-lg bg-card shadow-card">
          <SectionError what="today's health" />
        </div>
      ) : metrics.length === 0 ? (
        <div className="rounded-lg bg-card shadow-card">
          <EmptyState icon={<HeartPulse />} title="No health data yet" description="Connect Apple Health in the HealthMate iPhone app and turn on sync to see your daily snapshot here." />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 [&>*]:min-w-0">
          {metrics.map((m, i) => {
            const p = presentMetric(m);
            return (
              <MetricCard
                key={m.kind}
                label={p.label}
                value={p.value}
                unit={p.unit}
                context={p.context}
                tone={p.tone}
                icon={METRIC_ICON[m.kind]}
                href={metricHref(m.kind)}
                beat={m.kind === "heart_rate"}
                className="animate-fade-up"
                style={{ animationDelay: `${120 + i * 70}ms` }}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
