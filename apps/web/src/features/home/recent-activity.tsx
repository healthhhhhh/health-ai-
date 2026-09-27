import type { ActivityEvent } from "@healthmate/shared-types";
import { History } from "lucide-react";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { TimelineItem } from "@/components/ui/timeline-item";
import { formatRelative } from "@/lib/format";
import { ACTIVITY_META } from "./activity-meta";

export function RecentActivity({ events, serverNow, className }: { events: ActivityEvent[]; serverNow: string; className?: string }) {
  const now = new Date(serverNow);
  return (
    <Card className={className}>
      <CardHeader
        title="Recent Activity"
        action={
          <Link href="/timeline" className="text-caption font-semibold text-primary hover:underline underline-offset-4">
            Timeline
          </Link>
        }
      />
      {events.length === 0 ? (
        <EmptyState icon={<History />} title="No activity yet" description="Uploads, check-ins and synced data will appear here." className="py-6" />
      ) : (
        <ol className="flex flex-col gap-1">
          {events.map((e, i) => (
            <TimelineItem key={e.id} icon={ACTIVITY_META[e.kind].icon} tone={ACTIVITY_META[e.kind].tone} title={e.title} time={formatRelative(e.occurredAt, now)} isLast={i === events.length - 1} compact />
          ))}
        </ol>
      )}
    </Card>
  );
}
