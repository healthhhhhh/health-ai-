import { CircleHelp, FileText, History, House, LayoutDashboard, ListChecks, MessageCircle, Settings, Stethoscope, User, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  /** Shorter label for the mobile bottom bar. */
  shortLabel?: string;
  icon: LucideIcon;
}

export const PRIMARY_NAV: NavItem[] = [
  { href: "/home", label: "Home", icon: House },
  { href: "/chat", label: "AI Chat", shortLabel: "Chat", icon: MessageCircle },
  { href: "/health", label: "Health Dashboard", shortLabel: "Health", icon: LayoutDashboard },
  { href: "/reports", label: "Medical Reports", shortLabel: "Reports", icon: FileText },
  { href: "/plans", label: "Medications & Tasks", shortLabel: "Plans", icon: ListChecks },
  { href: "/care", label: "Find Care", shortLabel: "Care", icon: Stethoscope },
  { href: "/timeline", label: "Health Timeline", shortLabel: "Timeline", icon: History },
  { href: "/profile", label: "Profile", icon: User },
];

export const SECONDARY_NAV: NavItem[] = [
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/help", label: "Help & Support", icon: CircleHelp },
];

/** The five destinations in the mobile-web bottom bar — mirrors the iOS tab bar. */
export const BOTTOM_NAV_HREFS = ["/home", "/chat", "/health", "/plans", "/profile"] as const;

export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
