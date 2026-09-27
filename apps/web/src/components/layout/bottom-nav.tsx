"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { BOTTOM_NAV_HREFS, isActive, PRIMARY_NAV } from "@/lib/navigation";

const items = BOTTOM_NAV_HREFS.map((href) => PRIMARY_NAV.find((i) => i.href === href)!);

/** Phone-width tab bar, mirroring the iOS app's five tabs. */
export function BottomNav() {
  const pathname = usePathname() ?? "";
  return (
    <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-20 border-t border-separator bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden">
      <ul className="grid grid-cols-5">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn("flex h-16 flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium", active ? "text-primary" : "text-text-muted hover:text-text-secondary")}
              >
                <Icon aria-hidden className="size-6" strokeWidth={active ? 2.2 : 1.8} />
                {item.shortLabel ?? item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
