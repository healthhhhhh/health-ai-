"use client";

import { useClientClock } from "@/hooks/use-client-clock";
import { formatLongDate, greeting, hourInTimeZone } from "@/lib/format";

export function Greeting({ firstName, serverNow, timeZone }: { firstName: string; serverNow: string; timeZone: string }) {
  const { now, timeZone: tz } = useClientClock(serverNow, timeZone);
  return (
    <header>
      <p className="text-caption font-medium text-text-secondary">{formatLongDate(now, tz)}</p>
      <h1 className="text-page-heading text-text-primary sm:text-[1.875rem]">{greeting(hourInTimeZone(now, tz), firstName)}</h1>
      <p className="text-body text-text-secondary">How are you feeling today?</p>
    </header>
  );
}
