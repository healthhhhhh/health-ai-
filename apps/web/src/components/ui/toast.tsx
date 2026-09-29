"use client";

import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export type ToastTone = "success" | "info" | "error";

interface Toast {
  id: number;
  title: string;
  description?: string;
  tone: ToastTone;
}

const ToastContext = createContext<((toast: Omit<Toast, "id">) => void) | null>(null);

const icons: Record<ToastTone, ReactNode> = { success: <CircleCheck />, info: <Info />, error: <CircleAlert /> };
const tones: Record<ToastTone, string> = { success: "text-success", info: "text-primary", error: "text-error" };

/** Brief confirmations ("Saved", "Copied") in a polite live region. Errors that need action belong inline, not in a toast. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(0);
  const show = useCallback((toast: Omit<Toast, "id">) => {
    const id = ++next.current;
    setToasts((list) => [...list.slice(-2), { ...toast, id }]);
  }, []);
  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-4 md:bottom-6">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 4000);
    return () => clearTimeout(timer);
  }, [onDismiss]);
  return (
    <div
      role={toast.tone === "error" ? "alert" : "status"}
      className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg bg-card p-3.5 shadow-raised ring-1 ring-separator motion-safe:animate-[toast-in_0.25s_ease-out]"
    >
      <span aria-hidden className={cn("mt-0.5 [&_svg]:size-5", tones[toast.tone])}>
        {icons[toast.tone]}
      </span>
      <div className="flex-1">
        <p className="text-body font-semibold text-text-primary">{toast.title}</p>
        {toast.description && <p className="text-caption text-text-secondary">{toast.description}</p>}
      </div>
      <button type="button" onClick={onDismiss} aria-label="Dismiss" className="rounded-full p-1 text-text-muted hover:bg-card-muted">
        <X aria-hidden className="size-4" />
      </button>
    </div>
  );
}

/** `const toast = useToast(); toast({ title: "Saved", tone: "success" })` */
export function useToast() {
  const show = useContext(ToastContext);
  return useMemo(() => show ?? (() => undefined), [show]);
}
