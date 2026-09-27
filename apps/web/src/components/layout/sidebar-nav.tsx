"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { isActive, PRIMARY_NAV, SECONDARY_NAV, type NavItem } from "@/lib/navigation";

function NavLink({ item, pathname, onNavigate }: { item: NavItem; pathname: string; onNavigate?: () => void }) {
  const active = isActive(pathname, item.href);
  const Icon = item.icon;
  return (
    <li>
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex h-11 items-center gap-3 rounded-md px-3 text-[0.9375rem] transition-colors",
          active ? "bg-primary-soft font-semibold text-primary" : "font-medium text-text-secondary hover:bg-card-muted hover:text-text-primary",
        )}
      >
        <Icon aria-hidden className="size-5 shrink-0" strokeWidth={active ? 2.2 : 1.8} />
        {item.label}
      </Link>
    </li>
  );
}

/** Primary + secondary navigation lists. Shared by the desktop sidebar and the mobile drawer. */
export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname() ?? "";
  return (
    <div className="flex flex-1 flex-col justify-between gap-6">
      <ul className="flex flex-col gap-1">
        {PRIMARY_NAV.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
        ))}
      </ul>
      <ul className="flex flex-col gap-1">
        {SECONDARY_NAV.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
        ))}
      </ul>
    </div>
  );
}
