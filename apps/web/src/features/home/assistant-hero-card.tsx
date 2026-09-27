import { ArrowRight, Upload } from "lucide-react";
import { Mascot } from "@/components/illustrations/mascot";
import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export function AssistantHeroCard({ firstName, className }: { firstName: string; className?: string }) {
  return (
    <section aria-labelledby="assistant-hero-title" className={cn("bg-hero-gradient relative overflow-hidden rounded-xl p-5 sm:p-7", className)}>
      <div className="flex items-center gap-4 sm:gap-8">
        <Mascot decorative withBackdrop className="size-24 sm:size-44" />
        <div className="min-w-0 flex-1">
          <h2 id="assistant-hero-title" className="text-section-heading text-text-primary sm:text-2xl sm:leading-8 sm:font-bold">
            Hi {firstName}, I&apos;m your AI Health Assistant
          </h2>
          <p className="mt-2 hidden text-body text-text-secondary sm:block">
            I can help you understand symptoms, explain your reports, track your health and prepare for your next appointment.
          </p>
          <p className="mt-1 text-caption text-text-secondary sm:hidden">Ask about symptoms, reports or your health data.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <ButtonLink href="/chat" size="md" className="h-10 px-4 text-caption sm:h-11 sm:px-5 sm:text-body">
              Start a Conversation <ArrowRight aria-hidden />
            </ButtonLink>
            <ButtonLink href="/reports" variant="secondary" size="md" className="hidden sm:inline-flex">
              <Upload aria-hidden /> Upload a Report
            </ButtonLink>
          </div>
        </div>
      </div>
    </section>
  );
}
