"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/illustrations/logo";
import { Avatar } from "@/components/ui/avatar";
import { SearchBar } from "@/components/ui/search-bar";
import { MobileNavDrawer } from "./mobile-nav-drawer";

export function TopBar({ userName, unreadNotifications }: { userName: string; unreadNotifications: number | null }) {
  const router = useRouter();
  const ask = (q: string) => router.push(`/chat?q=${encodeURIComponent(q)}`);
  return (
    <header className="sticky top-0 z-20 border-b border-separator/70 bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-3 px-4 sm:px-6 lg:px-8">
        <MobileNavDrawer />
        <Link href="/home" className="text-lg lg:hidden" aria-label="HealthMate home">
          <Logo size={26} />
        </Link>
        <SearchBar onSubmit={ask} shortcutHint="⌘K" className="hidden h-11 max-w-xl flex-1 md:flex" />
        <div className="ml-auto flex items-center gap-1">
          <Link
            href="/notifications"
            aria-label={unreadNotifications ? `Notifications, ${unreadNotifications} unread` : "Notifications"}
            className="relative inline-flex size-11 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-card-muted hover:text-text-primary"
          >
            <Bell aria-hidden className="size-5" />
            {!!unreadNotifications && (
              <span aria-hidden className="absolute top-1.5 right-1.5 flex min-w-4.5 items-center justify-center rounded-pill bg-error-fill px-1 text-[0.6875rem] leading-4.5 font-bold text-on-primary tabular-nums">
                {unreadNotifications > 9 ? "9+" : unreadNotifications}
              </span>
            )}
          </Link>
          <Link href="/profile" aria-label="Your profile" className="rounded-full">
            <Avatar name={userName} />
          </Link>
        </div>
      </div>
    </header>
  );
}
