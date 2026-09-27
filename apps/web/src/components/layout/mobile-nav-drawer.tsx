"use client";

import { Menu, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/illustrations/logo";
import { IconButton } from "@/components/ui/icon-button";
import { SidebarNav } from "./sidebar-nav";

/** Full navigation for tablet and phone widths, in a native modal <dialog>. */
export function MobileNavDrawer() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal?.();
    if (!open && d.open) d.close?.();
  }, [open]);

  // Close when the route changes (e.g. browser back).
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  return (
    <>
      <IconButton label="Open menu" icon={<Menu />} onClick={() => setOpen(true)} className="lg:hidden" aria-expanded={open} aria-controls="mobile-nav" />
      <dialog
        id="mobile-nav"
        ref={ref}
        aria-label="Main menu"
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === ref.current) setOpen(false);
        }}
        className="m-0 h-dvh max-h-dvh w-[min(20rem,85vw)] bg-card p-0 text-text-primary shadow-card backdrop:bg-text-primary/30"
      >
        <div className="flex h-full flex-col gap-6 px-4 py-5">
          <div className="flex items-center justify-between px-2">
            <Logo />
            <IconButton label="Close menu" icon={<X />} onClick={() => setOpen(false)} />
          </div>
          <nav aria-label="Main" className="flex flex-1 flex-col">
            <SidebarNav onNavigate={() => setOpen(false)} />
          </nav>
        </div>
      </dialog>
    </>
  );
}
