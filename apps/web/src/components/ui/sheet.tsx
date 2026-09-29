"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { IconButton } from "./icon-button";

/**
 * A panel for forms and details that shouldn't leave the page: slides up from
 * the bottom on phones and in from the right on larger screens. Built on
 * <dialog> for focus trapping and Escape.
 */
export function Sheet({ open, onClose, title, description, children, footer }: { open: boolean; onClose: () => void; title: string; description?: string; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal?.();
    if (!open && dialog.open) dialog.close?.();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cn(
        "m-0 mt-auto max-h-[90dvh] w-full max-w-none rounded-t-xl bg-card p-0 text-text-primary shadow-raised backdrop:bg-text-primary/30",
        "md:mt-0 md:ml-auto md:h-dvh md:max-h-none md:w-[28rem] md:rounded-none md:rounded-l-xl",
      )}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-start justify-between gap-4 border-b border-separator p-5">
          <div>
            <h2 id={titleId} className="text-section-heading">
              {title}
            </h2>
            {description && <p className="mt-1 text-body text-text-secondary">{description}</p>}
          </div>
          <IconButton label="Close" icon={<X />} onClick={onClose} className="-mt-1 -mr-2" />
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        {footer && <div className="flex justify-end gap-3 border-t border-separator p-5">{footer}</div>}
      </div>
    </dialog>
  );
}
