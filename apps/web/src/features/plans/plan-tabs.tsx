import Link from "next/link";
import { cn } from "@/lib/cn";

const TABS = [
  { href: "/plans", label: "Day" },
  { href: "/plans/tasks", label: "All tasks" },
  { href: "/plans/medications", label: "Medications" },
] as const;

/** Views of the plan: one day, everything across days, and medications. */
export function PlanTabs({ current }: { current: (typeof TABS)[number]["href"] }) {
  return (
    <nav aria-label="Plan views" className="mb-4 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.href === current ? "page" : undefined}
          className={cn(
            "inline-flex h-9 shrink-0 items-center rounded-pill px-4 text-caption font-semibold transition-colors",
            t.href === current ? "bg-primary-fill text-on-primary shadow-raised" : "bg-card text-text-secondary ring-1 ring-separator hover:text-text-primary",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
