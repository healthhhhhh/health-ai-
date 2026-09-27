"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { IconButton } from "./icon-button";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

/**
 * Accessible modal built on the native <dialog> element, which provides focus
 * trapping, Escape-to-close and inert background for free.
 */
export function Modal({ open, onClose, title, description, children, footer, className }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

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
      aria-describedby={description ? descId : undefined}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        "m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl bg-card p-0 text-text-primary shadow-card backdrop:bg-text-primary/30 backdrop:backdrop-blur-[2px]",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4 p-6 pb-2">
        <div>
          <h2 id={titleId} className="text-section-heading">
            {title}
          </h2>
          {description && (
            <p id={descId} className="mt-1 text-body text-text-secondary">
              {description}
            </p>
          )}
        </div>
        <IconButton label="Close" icon={<X />} onClick={onClose} className="-mt-1 -mr-2" />
      </div>
      <div className="px-6 py-4">{children}</div>
      {footer && <div className="flex justify-end gap-3 px-6 pb-6">{footer}</div>}
    </dialog>
  );
}
