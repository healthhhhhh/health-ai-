"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/illustrations/logo";
import { Avatar } from "@/components/ui/avatar";
import { SearchBar } from "@/components/ui/search-bar";
import { MobileNavDrawer } from "./mobile-nav-drawer";

export function TopBar({ userName }: { userName: string }) {
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
          <Link href="/profile" aria-label="Your profile" className="rounded-full">
            <Avatar name={userName} />
          </Link>
        </div>
      </div>
    </header>
  );
}
