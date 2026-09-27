"use client";

import { useEffect, useState } from "react";

/**
 * Hydration-safe "now". The server renders with the time and zone it was
 * given; once mounted, the client switches to the viewer's own clock and time
 * zone so greetings and relative times are correct for them.
 */
export function useClientClock(serverNowIso: string, fallbackTimeZone: string) {
  const [clock, setClock] = useState(() => ({ now: new Date(serverNowIso), timeZone: fallbackTimeZone }));
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || fallbackTimeZone;
    const update = () => setClock({ now: new Date(), timeZone: tz });
    update();
    const id = window.setInterval(update, 60_000);
    return () => window.clearInterval(id);
  }, [fallbackTimeZone]);
  return clock;
}
