import { cn } from "@/lib/cn";

/** "The assistant is writing" — three dots that bounce (static when Reduce Motion is on). */
export function TypingIndicator({ label = "HealthMate is writing a reply", className }: { label?: string; className?: string }) {
  return (
    <div role="status" className={cn("inline-flex items-center gap-1 rounded-lg rounded-bl-sm bg-card-muted px-4 py-3", className)}>
      <span className="sr-only">{label}</span>
      {[0, 150, 300].map((delay) => (
        <span key={delay} aria-hidden className="size-2 rounded-full bg-text-secondary motion-safe:animate-typing" style={{ animationDelay: `${delay}ms` }} />
      ))}
    </div>
  );
}
