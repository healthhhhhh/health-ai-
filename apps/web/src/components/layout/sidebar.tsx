import Link from "next/link";
import { Logo } from "@/components/illustrations/logo";
import { SidebarNav } from "./sidebar-nav";

export function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-8 border-r border-separator bg-card px-4 py-6 lg:flex">
      <Link href="/home" className="px-2 text-lg" aria-label="HealthMate home">
        <Logo />
      </Link>
      <nav aria-label="Main" className="flex flex-1 flex-col">
        <SidebarNav />
      </nav>
    </aside>
  );
}
