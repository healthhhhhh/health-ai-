import type { HealthMetric, PlanTask } from "@healthmate/shared-types";
import { Card, CardHeader } from "@/components/ui/card";
import { ProgressBar, ProgressRing } from "@/components/ui/progress";
import { formatNumber } from "@/lib/format";
import { planProgress } from "./plan";

/**
 * Progress toward goals the user set — deliberately not a "health score",
 * which would imply a clinical assessment the app can't make.
 */
export function DailyProgress({ tasks, metrics, className }: { tasks: PlanTask[]; metrics: HealthMetric[]; className?: string }) {
  const { done, total, ratio } = planProgress(tasks);
  const steps = metrics.find((m) => m.kind === "steps");
  return (
    <Card className={className}>
      <CardHeader title="Daily Progress" />
      <div className="flex items-center gap-6">
        <ProgressRing value={Math.round(ratio * 100)} label="Today's plan completed, percent" size={124}>
          <span className="text-metric text-text-primary">{Math.round(ratio * 100)}%</span>
          <span className="text-xs font-semibold text-text-secondary">of plan</span>
        </ProgressRing>
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div>
            <div className="flex justify-between text-caption">
              <span className="font-semibold text-text-primary">Plan tasks</span>
              <span className="text-text-secondary tabular-nums">
                {done} / {total}
              </span>
            </div>
            <ProgressBar value={done} max={total || 1} tone="green" label="Plan tasks completed" className="mt-1.5" />
          </div>
          {steps?.goal && (
            <div>
              <div className="flex justify-between text-caption">
                <span className="font-semibold text-text-primary">Steps</span>
                <span className="text-text-secondary tabular-nums">
                  {formatNumber(steps.value)} / {formatNumber(steps.goal)}
                </span>
              </div>
              <ProgressBar value={steps.value} max={steps.goal} tone="blue" label="Steps toward your goal" className="mt-1.5" />
            </div>
          )}
          <p className="text-caption text-text-secondary">Goals you set yourself. Keep going!</p>
        </div>
      </div>
    </Card>
  );
}
