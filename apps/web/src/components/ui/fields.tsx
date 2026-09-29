import { useId, type ComponentProps } from "react";
import { cn } from "@/lib/cn";

const control =
  "rounded-md bg-card px-4 text-body text-text-primary ring-1 ring-separator placeholder:text-text-muted transition-shadow focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none";

function Field({ id, label, hint, error, hideLabel, counter, children }: { id: string; label: string; hint?: string; error?: string; hideLabel?: boolean; counter?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className={cn("text-caption font-semibold text-text-primary", hideLabel && "sr-only")}>
          {label}
        </label>
        {counter && <span className="text-xs text-text-muted">{counter}</span>}
      </div>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-caption text-text-secondary">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-caption font-medium text-error">
          {error}
        </p>
      )}
    </div>
  );
}

const describedBy = (id: string, hint?: string, error?: string) => [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;

/** Multi-line text with an optional character counter. */
export function Textarea({ label, hint, error, hideLabel, className, id, maxLength, value, ...props }: ComponentProps<"textarea"> & { label: string; hint?: string; error?: string; hideLabel?: boolean }) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const counter = maxLength && typeof value === "string" ? `${value.length}/${maxLength}` : undefined;
  return (
    <Field id={fieldId} label={label} hint={hint} error={error} hideLabel={hideLabel} counter={counter}>
      <textarea
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fieldId, hint, error)}
        maxLength={maxLength}
        value={value}
        className={cn(control, "min-h-24 py-3", error && "ring-error", className)}
        {...props}
      />
    </Field>
  );
}

/** Native select (best on every platform), styled like the inputs. */
export function Select({
  label,
  hint,
  error,
  hideLabel,
  options,
  className,
  id,
  ...props
}: ComponentProps<"select"> & { label: string; hint?: string; error?: string; hideLabel?: boolean; options: { value: string; label: string }[] }) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <Field id={fieldId} label={label} hint={hint} error={error} hideLabel={hideLabel}>
      <select id={fieldId} aria-invalid={error ? true : undefined} aria-describedby={describedBy(fieldId, hint, error)} className={cn(control, "h-12 pr-10", error && "ring-error", className)} {...props}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** Single-choice filter pills (e.g. All · Reports · Photos). */
export function FilterChips<T extends string>({ options, value, onChange, label, className }: { options: { value: T; label: string; count?: number }[]; value: T; onChange: (value: T) => void; label: string; className?: string }) {
  return (
    <div role="group" aria-label={label} className={cn("flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]", className)}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-pill px-4 text-caption font-semibold transition-colors",
              selected ? "bg-primary-fill text-on-primary shadow-raised" : "bg-card text-text-secondary ring-1 ring-separator hover:text-text-primary",
            )}
          >
            {o.label}
            {o.count !== undefined && <span className={cn("rounded-pill px-1.5 text-xs", selected ? "bg-card text-primary" : "bg-card-muted")}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
