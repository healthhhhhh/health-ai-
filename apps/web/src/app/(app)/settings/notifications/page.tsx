import type { NotificationPreferences } from "@healthmate/shared-types";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { StateView } from "@/components/ui/state-view";
import { NotificationForm } from "@/features/settings/notification-form";
import { api, ApiError } from "@/lib/api/server";

export const metadata: Metadata = { title: "Notification settings" };
export const dynamic = "force-dynamic";

export default async function NotificationSettingsPage() {
  const prefs = await api<NotificationPreferences>("me/notification-preferences").catch((error) => {
    if (error instanceof ApiError && error.status !== 401) return error;
    throw error;
  });
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <Link href="/settings" className="inline-flex items-center gap-1 self-start text-caption font-semibold text-primary hover:underline">
        <ArrowLeft aria-hidden className="size-4" /> Settings
      </Link>
      <PageHeader title="Notifications" description="Reminders are delivered by the HealthMate iPhone app. Allow notifications for HealthMate in the iPhone's Settings too." />
      <Card>
        {prefs instanceof ApiError ? (
          <StateView
            state={prefs.status === 404 || prefs.status === 405 ? "empty" : prefs.code === "network" ? "offline" : "error"}
            title={prefs.status === 404 || prefs.status === 405 ? "Not available on this server yet" : prefs.code === "network" ? undefined : "Notification settings couldn't load"}
            description={prefs.status === 404 || prefs.status === 405 ? "Notification settings are managed in the iPhone app for now." : undefined}
            action={
              <Link href="/settings/notifications" prefetch={false} className="text-caption font-semibold text-primary hover:underline">
                Try again
              </Link>
            }
          />
        ) : (
          <NotificationForm prefs={prefs} />
        )}
      </Card>
    </div>
  );
}
