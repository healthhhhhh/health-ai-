import type { Metadata } from "next";
import { Bell, BellOff, ChevronRight, Pill } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SourceBadge } from "@/components/ui/content-labels";
import { Disclaimer } from "@/components/ui/disclaimer";
import { StateView } from "@/components/ui/state-view";
import { PlanError } from "@/features/plans/plan-error";
import { PlanTabs } from "@/features/plans/plan-tabs";
import { getPlan, getProfile } from "@/lib/api/data";
import { ApiError } from "@/lib/api/server";
import { formatClockTime } from "@/lib/format";
import { adherence, dayIn, describeRepeat, unifiedMedications } from "@/lib/plan";

export const metadata: Metadata = { title: "Medications" };
export const dynamic = "force-dynamic";

/** Every medication in one place: plan reminders and the health profile, each instruction exactly as entered. */
export default async function MedicationsPage() {
  const loaded = await Promise.all([getProfile(), getPlan()]).catch((error) => {
    if (error instanceof ApiError && error.status !== 401) return error;
    throw error;
  });
  const header = <PageHeader title="Medications & Tasks" description="Your plan — shared with the HealthMate iPhone app, which sends the reminders." />;
  if (loaded instanceof ApiError) {
    return (
      <>
        {header}
        <PlanTabs current="/plans/medications" />
        <PlanError error={loaded} retry="/plans/medications" />
      </>
    );
  }
  const [health, plan] = loaded;
  const today = dayIn(new Date(), health.profile.timeZone);
  const medications = unifiedMedications(plan, health.medications);

  return (
    <>
      {header}
      <PlanTabs current="/plans/medications" />
      <div className="flex max-w-3xl flex-col gap-4">
        {medications.length === 0 ? (
          <Card>
            <StateView
              state="empty"
              icon={<Pill />}
              title="No medications yet"
              description="Add a medication with its instructions exactly as written on the label or prescription, and get reminders on your iPhone."
              action={
                <Link href="/plans?add=medication#add" className="text-caption font-semibold text-primary hover:underline">
                  Add a medication
                </Link>
              }
            />
          </Card>
        ) : (
          medications.map((m) => {
            const item = m.planItem;
            const stats = item ? adherence(plan, item, today) : null;
            return (
              <Card as="article" key={m.key} aria-label={m.name}>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-card-title text-text-primary">{m.name}</h2>
                  <SourceBadge source={item?.source ?? m.profile!.source} />
                  {m.profile && item && <span className="text-xs text-text-secondary">Also in your profile</span>}
                </div>
                <p className="mt-3 text-xs font-semibold text-text-secondary">Instructions, exactly as entered</p>
                <p className="text-body text-text-primary">{m.instruction ?? "No instructions saved"}</p>
                {item ? (
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-text-secondary">
                    <span>
                      {formatClockTime(item.time)} · {describeRepeat(item.repeat)}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      {item.reminderEnabled ? <Bell aria-hidden className="size-3.5" /> : <BellOff aria-hidden className="size-3.5" />}
                      Reminder {item.reminderEnabled ? "on" : "off"}
                    </span>
                    {stats && stats.scheduled > 0 && (
                      <span>
                        Taken on {stats.done} of {stats.scheduled} scheduled days this week
                      </span>
                    )}
                    <Link href={`/plans/${encodeURIComponent(item.id)}`} className="ml-auto inline-flex items-center gap-1 font-semibold text-primary hover:underline">
                      Details <ChevronRight aria-hidden className="size-4" />
                    </Link>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <p className="text-caption text-text-secondary">In your profile, not in your plan — no reminders.</p>
                    <Link href={`/plans?add=${encodeURIComponent(m.key)}#add`} className={buttonVariants({ variant: "soft", size: "sm" })}>
                      <Bell aria-hidden /> Add a reminder
                    </Link>
                  </div>
                )}
              </Card>
            );
          })
        )}
        <p className="text-caption text-text-secondary">Reminders are sent by the HealthMate iPhone app. Marking a dose as taken on the web updates your plan everywhere.</p>
        <Disclaimer>Never start, stop or change a medication or dose without talking to your clinician.</Disclaimer>
      </div>
    </>
  );
}
