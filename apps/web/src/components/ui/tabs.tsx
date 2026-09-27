"use client";

import { useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";

export interface TabItem<T extends string> {
  value: T;
  label: string;
}

interface TabsProps<T extends string> {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  variant?: "segmented" | "underline";
  className?: string;
  /** Prefix for tab/panel ids so panels can reference `${idPrefix}-tab-${value}`. */
  idPrefix: string;
}

/** WAI-ARIA tabs with arrow-key navigation. Render panels with `TabPanel`. */
export function Tabs<T extends string>({ items, value, onChange, label, variant = "segmented", className, idPrefix }: TabsProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (e: KeyboardEvent, index: number) => {
    const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!delta && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (index + delta + items.length) % items.length;
    const item = items[next];
    if (!item) return;
    onChange(item.value);
    refs.current[next]?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn(variant === "segmented" ? "inline-flex gap-1 rounded-pill bg-card-muted p-1 ring-1 ring-separator" : "flex gap-6 border-b border-separator", className)}
    >
      {items.map((item, i) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            type="button"
            id={`${idPrefix}-tab-${item.value}`}
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel-${item.value}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "text-caption font-semibold transition-colors",
              variant === "segmented"
                ? cn("h-9 flex-1 rounded-pill px-4", selected ? "bg-card text-primary shadow-card" : "text-text-secondary hover:text-text-primary")
                : cn("-mb-px border-b-2 pb-2.5", selected ? "border-primary text-primary" : "border-transparent text-text-secondary hover:text-text-primary"),
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ idPrefix, value, hidden, children }: { idPrefix: string; value: string; hidden: boolean; children: React.ReactNode }) {
  return (
    <div role="tabpanel" id={`${idPrefix}-panel-${value}`} aria-labelledby={`${idPrefix}-tab-${value}`} hidden={hidden}>
      {children}
    </div>
  );
}
