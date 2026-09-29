"use client";

import { Camera, FileText, Paperclip } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

/** "+" beside the message box: add a report or a photo (opens the Reports upload with that option chosen). */
export function AttachMenu() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onClick = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick);
    };
  }, [open]);

  const item = "flex items-center gap-3 px-3 py-2.5 text-caption text-text-primary hover:bg-card-muted";
  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-label="Add a report or photo"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex size-11 items-center justify-center rounded-full text-text-secondary ring-1 ring-separator hover:bg-card-muted hover:text-text-primary"
      >
        <Paperclip aria-hidden className="size-5" />
      </button>
      {open && (
        <div role="menu" className="absolute bottom-full left-0 z-10 mb-2 w-64 overflow-hidden rounded-md bg-card py-1 shadow-raised ring-1 ring-separator">
          <Link role="menuitem" href="/reports?upload=report#upload" className={item}>
            <FileText aria-hidden className="size-4 text-primary" />
            <span>
              <span className="block font-semibold">Upload a report</span>
              <span className="text-xs text-text-secondary">Lab results or a clinic letter</span>
            </span>
          </Link>
          <Link role="menuitem" href="/reports?upload=photo#upload" className={item}>
            <Camera aria-hidden className="size-4 text-purple" />
            <span>
              <span className="block font-semibold">Check a photo</span>
              <span className="text-xs text-text-secondary">A skin concern, a rash or a wound</span>
            </span>
          </Link>
        </div>
      )}
    </div>
  );
}
