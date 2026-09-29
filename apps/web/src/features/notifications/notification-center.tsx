"use client";

import type { NotificationCategory, NotificationRecord } from "@healthmate/shared-types";
import { BellOff, CheckCheck, MoreHorizontal, Trash2 } from "lucide-react";
import { useEffect, useOptimistic, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { FilterChips } from "@/components/ui/fields";
import { NotificationRow, notificationCategories } from "@/components/ui/notification-row";
import { StateView } from "@/components/ui/state-view";
import { useToast } from "@/components/ui/toast";
import { formatRelative } from "@/lib/format";
import { safeInAppLink } from "@/lib/links";
import { deleteNotification, markAllNotificationsRead, setNotificationRead } from "./actions";

type Filter = "all" | "unread" | NotificationCategory;

type Change = { type: "read"; id: string; read: boolean } | { type: "read-all" } | { type: "delete"; id: string };

function dayKey(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

/**
 * The notification centre: filter by unread or category, open a notification
 * (marks it read and goes to what it's about), mark all read, or delete.
 */
export function NotificationCenter({ notifications, serverNow, timeZone }: { notifications: NotificationRecord[]; serverNow: string; timeZone: string }) {
  const [items, apply] = useOptimistic(notifications, (state, change: Change) => {
    const now = new Date().toISOString();
    switch (change.type) {
      case "read":
        return state.map((n) => (n.id === change.id ? { ...n, readAt: change.read ? (n.readAt ?? now) : null } : n));
      case "read-all":
        return state.map((n) => ({ ...n, readAt: n.readAt ?? now }));
      case "delete":
        return state.filter((n) => n.id !== change.id);
    }
  });
  const [filter, setFilter] = useState<Filter>("all");
  const [menu, setMenu] = useState<string | null>(null);
  const [, start] = useTransition();
  const toast = useToast();
  const now = new Date(serverNow);

  useEffect(() => {
    // Close the options menu with Escape or a click elsewhere.
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    const onClick = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-notification-menu]")) setMenu(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick);
    };
  }, [menu]);

  const change = (c: Change, work: () => Promise<{ error?: string }>, success?: string) =>
    start(async () => {
      apply(c);
      const result = await work();
      if (result.error) toast({ tone: "error", title: "Couldn't update notifications", description: result.error });
      else if (success) toast({ tone: "success", title: success });
    });

  const unread = items.filter((n) => !n.readAt).length;
  const categories = (Object.keys(notificationCategories) as NotificationCategory[]).filter((c) => items.some((n) => n.category === c));
  const shown = items.filter((n) => (filter === "all" ? true : filter === "unread" ? !n.readAt : n.category === filter));
  const today = dayKey(serverNow, timeZone);
  const groups = [
    { title: "Today", items: shown.filter((n) => dayKey(n.createdAt, timeZone) === today) },
    { title: "Earlier", items: shown.filter((n) => dayKey(n.createdAt, timeZone) !== today) },
  ].filter((g) => g.items.length > 0);

  if (items.length === 0) {
    return (
      <div className="rounded-xl bg-card shadow-card">
        <StateView state="empty" icon={<BellOff />} title="No notifications yet" description="Reminders, report updates and account alerts will appear here." />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterChips<Filter>
          label="Show"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "unread", label: "Unread", count: unread },
            ...categories.map((c) => ({ value: c as Filter, label: notificationCategories[c].label })),
          ]}
        />
        <Button variant="secondary" size="sm" disabled={unread === 0} onClick={() => change({ type: "read-all" }, markAllNotificationsRead, "All caught up")}>
          <CheckCheck aria-hidden /> Mark all as read
        </Button>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-xl bg-card shadow-card">
          <StateView state="success" title="You're all caught up" description={filter === "unread" ? "No unread notifications." : "Nothing in this category."} />
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.title} aria-labelledby={`group-${group.title}`} className="overflow-hidden rounded-xl bg-card shadow-card">
            <h2 id={`group-${group.title}`} className="px-5 pt-4 pb-1 text-caption font-semibold tracking-wide text-text-secondary uppercase">
              {group.title}
            </h2>
            <ul className="divide-y divide-separator">
              {group.items.map((n) => (
                <li key={n.id} className="relative flex items-stretch">
                  <NotificationRow
                    category={n.category}
                    title={n.title}
                    body={n.body}
                    time={formatRelative(n.createdAt, now)}
                    read={Boolean(n.readAt)}
                    aiGenerated={n.aiGenerated}
                    href={safeInAppLink(n.link)}
                    onOpen={() => {
                      if (!n.readAt) change({ type: "read", id: n.id, read: true }, () => setNotificationRead(n.id, true));
                    }}
                    className="pr-14"
                  />
                  <div className="absolute top-3 right-3" data-notification-menu>
                    <button
                      type="button"
                      aria-label={`Options for ${n.title}`}
                      aria-expanded={menu === n.id}
                      aria-haspopup="menu"
                      onClick={() => setMenu(menu === n.id ? null : n.id)}
                      className="rounded-full p-2 text-text-muted transition-colors hover:bg-card-muted hover:text-text-primary"
                    >
                      <MoreHorizontal aria-hidden className="size-4" />
                    </button>
                    {menu === n.id && (
                      <div role="menu" className="absolute right-0 z-10 mt-1 w-48 overflow-hidden rounded-md bg-card py-1 shadow-raised ring-1 ring-separator">
                        <button
                          role="menuitem"
                          type="button"
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-caption font-medium text-text-primary hover:bg-card-muted"
                          onClick={() => {
                            setMenu(null);
                            change({ type: "read", id: n.id, read: !n.readAt }, () => setNotificationRead(n.id, !n.readAt));
                          }}
                        >
                          <CheckCheck aria-hidden className="size-4" /> {n.readAt ? "Mark as unread" : "Mark as read"}
                        </button>
                        <button
                          role="menuitem"
                          type="button"
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-caption font-medium text-error hover:bg-card-muted"
                          onClick={() => {
                            setMenu(null);
                            change({ type: "delete", id: n.id }, () => deleteNotification(n.id), "Notification deleted");
                          }}
                        >
                          <Trash2 aria-hidden className="size-4" /> Delete
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
