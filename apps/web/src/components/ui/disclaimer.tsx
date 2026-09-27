import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/cn";

export function Disclaimer({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <p className={cn("flex items-start gap-2 text-caption text-text-secondary", className)}>
      <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
      <span>
        {children ??
          "HealthMate's AI Health Assistant offers general information, not a diagnosis. It is not a substitute for a doctor. In an emergency, contact your local emergency services."}
      </span>
    </p>
  );
}
