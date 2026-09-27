import type { Metadata } from "next";
import { getDataClient } from "@/lib/data";
import { AssistantHeroCard } from "@/features/home/assistant-hero-card";
import { DailyProgress } from "@/features/home/daily-progress";
import { Greeting } from "@/features/home/greeting";
import { HomeAskBar } from "@/features/home/home-ask-bar";
import { MoodCheckIn } from "@/features/home/mood-check-in";
import { RecentActivity } from "@/features/home/recent-activity";
import { TodaysHealth } from "@/features/home/todays-health";
import { TodaysPlan } from "@/features/home/todays-plan";
import { UpcomingAppointments } from "@/features/home/upcoming-appointments";
import { InsightCard } from "@/components/ui/insight-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Disclaimer } from "@/components/ui/disclaimer";

export const metadata: Metadata = { title: "Home" };
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const summary = await getDataClient().getHomeSummary();
  const serverNow = new Date().toISOString();
  const { user } = summary;

  return (
    <div className="flex flex-col gap-6">
      <div className="animate-fade-up">
        <Greeting firstName={user.firstName} serverNow={serverNow} timeZone={user.timeZone} />
      </div>
      <HomeAskBar />

      <div className="animate-fade-up grid gap-6 [animation-delay:60ms] xl:grid-cols-12 [&>*]:min-w-0">
        <AssistantHeroCard firstName={user.firstName} className="xl:col-span-8" />
        <MoodCheckIn initialMood={summary.todayMood?.mood} className="xl:col-span-4" />
      </div>

      <TodaysHealth metrics={summary.metrics} />

      <div className="animate-fade-up grid gap-6 [animation-delay:380ms] lg:grid-cols-12 [&>*]:min-w-0">
        <TodaysPlan tasks={summary.tasks} className="lg:col-span-7" />
        <div className="flex flex-col gap-6 lg:col-span-5">
          {summary.insight && (
            <InsightCard
              message={summary.insight.message}
              basedOn={summary.insight.basedOn}
              badge={summary.insight.source === "sample" ? <StatusBadge status="neutral">Sample</StatusBadge> : undefined}
            />
          )}
          <UpcomingAppointments appointments={summary.upcomingAppointments} serverNow={serverNow} timeZone={user.timeZone} />
        </div>
      </div>

      <div className="animate-fade-up grid gap-6 [animation-delay:480ms] lg:grid-cols-12 [&>*]:min-w-0">
        <RecentActivity events={summary.recentActivity} serverNow={serverNow} className="lg:col-span-7" />
        <DailyProgress tasks={summary.tasks} metrics={summary.metrics} className="lg:col-span-5" />
      </div>

      <Disclaimer className="pb-2" />
    </div>
  );
}
