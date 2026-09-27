import { useId, type ComponentProps } from "react";
import { cn } from "@/lib/cn";

interface InputProps extends ComponentProps<"input"> {
  label: string;
  hint?: string;
  error?: string;
  hideLabel?: boolean;
}

export function Input({ label, hint, error, hideLabel, className, id, ...props }: InputProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const describedBy = [hint && `${inputId}-hint`, error && `${inputId}-error`].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className={cn("text-caption font-semibold text-text-primary", hideLabel && "sr-only")}>
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          "h-12 rounded-md bg-card px-4 text-body text-text-primary ring-1 ring-separator placeholder:text-text-muted transition-shadow focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none",
          error && "ring-error",
          className,
        )}
        {...props}
      />
      {hint && !error && (
        <p id={`${inputId}-hint`} className="text-caption text-text-secondary">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${inputId}-error`} role="alert" className="text-caption font-medium text-error">
          {error}
        </p>
      )}
    </div>
  );
}
