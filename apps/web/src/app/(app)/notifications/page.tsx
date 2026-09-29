import type { NotificationList } from "@healthmate/shared-types";
import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { StateView } from "@/components/ui/state-view";
import { NotificationCenter } from "@/features/notifications/notification-center";
import { getProfile } from "@/lib/api/data";
import { api, ApiError } from "@/lib/api/server";

export const metadata: Metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const [{ profile }, list] = await Promise.all([
    getProfile(),
    api<NotificationList>("notifications").catch((error) => {
      if (error instanceof ApiError && error.status !== 401) return error;
      throw error;
    }),
  ]);
  return (
    <div className="max-w-3xl">
      <PageHeader title="Notifications" description="Reminders, report updates and account alerts." />
      {list instanceof ApiError ? (
        <div className="rounded-xl bg-card shadow-card">
          <StateView state={list.code === "network" ? "offline" : "error"} title={list.code === "network" ? undefined : "Couldn't load notifications"} />
        </div>
      ) : (
        <NotificationCenter notifications={list.notifications} serverNow={new Date().toISOString()} timeZone={profile.timeZone} />
      )}
    </div>
  );
}
