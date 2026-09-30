import type { HealthKitConnection } from "@healthmate/shared-types";
import { CircleAlert, CircleCheck, HeartPulse, LockKeyhole, Smartphone, Unplug } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { IconBadge } from "@/components/ui/icon-badge";
import { formatRelative } from "@/lib/format";
import { TurnOnSyncButton } from "./turn-on-sync-button";

const SCOPE_LABEL: Record<string, string> = { steps: "Steps", heart_rate: "Heart rate", resting_heart_rate: "Resting heart rate", sleep: "Sleep", active_energy: "Active energy", weight: "Weight" };

const formatDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const historyLabel = (days: number) => (days >= 700 ? "2 years" : days >= 360 ? "1 year" : days >= 85 ? "3 months" : `${days} days`);

/** Apple Health readings older than this are shown as "hasn't synced recently". */
export const STALE_SYNC_HOURS = 36;

export type AppleHealthState = "permission" | "never_connected" | "disconnected" | "stale" | "importing" | "connected" | "unknown";

/** Which connection state to show, from the sync consent and the connection record. */
export function appleHealthState(connection: HealthKitConnection | null, syncConsent: boolean, now = new Date()): AppleHealthState {
  if (!syncConsent) return "permission";
  if (!connection) return "unknown";
  if (connection.status === "never_connected") return "never_connected";
  if (connection.status === "disconnected") return "disconnected";
  if (!connection.lastSyncAt || now.getTime() - new Date(connection.lastSyncAt).getTime() > STALE_SYNC_HOURS * 3_600_000) return "stale";
  if (connection.history?.status === "importing" || connection.history?.status === "failed") return "importing";
  return "connected";
}

/**
 * Apple Health connection as the web sees it. Connecting and syncing happen in
 * the HealthMate iPhone app; the web shows the status and how to fix it.
 */
export function AppleHealthStatus({ connection, syncConsent, now }: { connection: HealthKitConnection | null; syncConsent: boolean; now: Date }) {
  const state = appleHealthState(connection, syncConsent, now);
  const lastSync = connection?.lastSyncAt ? formatRelative(connection.lastSyncAt, now) : null;

  const content: Record<AppleHealthState, { icon: ReactNode; tone: "green" | "orange" | "blue" | "purple"; title: string; body: ReactNode; action?: ReactNode }> = {
    connected: {
      icon: <CircleCheck />,
      tone: "green",
      title: `Apple Health connected${connection?.deviceName ? ` · ${connection.deviceName}` : ""}`,
      body: (
        <>
          Last synced {lastSync}. Shares {connection?.scopes.map((s) => SCOPE_LABEL[s] ?? s).join(", ") || "the readings you chose"}. Your iPhone keeps syncing in the background.
        </>
      ),
    },
    importing: {
      icon: <Smartphone />,
      tone: "blue",
      title: "Importing your Apple Health history",
      body: (
        <>
          {connection?.history?.from ? `Days from ${formatDay(connection.history.from)} onwards are here so far. ` : ""}Your iPhone continues the import whenever HealthMate is open there
          {connection?.history?.daysRequested ? ` (up to ${historyLabel(connection.history.daysRequested)})` : ""}. Last synced {lastSync}.
        </>
      ),
    },
    stale: {
      icon: <CircleAlert />,
      tone: "orange",
      title: "Apple Health hasn't synced recently",
      body: (
        <>
          {lastSync ? `The last sync was ${lastSync}. ` : ""}Open HealthMate on your iPhone and pull down on the Health tab to sync. If it keeps failing, check Settings › Health › Data Access on
          your iPhone.
        </>
      ),
    },
    disconnected: {
      icon: <Unplug />,
      tone: "orange",
      title: "Apple Health is disconnected",
      body: <>Readings you already synced are still here. To start syncing again, open HealthMate on your iPhone and choose Health › Connect Apple Health.</>,
    },
    never_connected: {
      icon: <Smartphone />,
      tone: "blue",
      title: "Connect Apple Health on your iPhone",
      body: <>Open HealthMate on your iPhone and choose Health › Connect Apple Health. You choose which readings to share, and they appear here as they sync.</>,
    },
    permission: {
      icon: <LockKeyhole />,
      tone: "purple",
      title: "Health data sync is off",
      body: <>HealthMate isn&apos;t allowed to store readings from Apple Health in your account. Readings you add yourself still work.</>,
      action: <TurnOnSyncButton />,
    },
    unknown: {
      icon: <HeartPulse />,
      tone: "blue",
      title: "Apple Health",
      body: <>Readings from Apple Health appear here after you connect it in the HealthMate iPhone app.</>,
    },
  };
  const c = content[state];
  return (
    <section aria-label="Apple Health connection" className="flex flex-wrap items-start gap-4 rounded-lg bg-card p-4 shadow-card">
      <IconBadge icon={c.icon} tone={c.tone} />
      <div className="min-w-0 flex-1">
        <h2 className="text-card-title text-text-primary">{c.title}</h2>
        <p className="mt-0.5 text-caption text-text-secondary">{c.body}</p>
        {state === "permission" && (
          <p className="mt-1 text-xs text-text-secondary">
            You can change this any time in{" "}
            <Link href="/settings" className="font-semibold text-primary hover:underline">
              Settings
            </Link>
            .
          </p>
        )}
      </div>
      {c.action && <div className="self-center">{c.action}</div>}
    </section>
  );
}
