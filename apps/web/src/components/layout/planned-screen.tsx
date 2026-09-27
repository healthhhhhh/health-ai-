import type { LucideIcon } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { Tone } from "@/lib/tone";
import { PageHeader } from "./page-header";

/**
 * A real, routable screen whose feature is scheduled for a later phase. Shows
 * an honest empty state instead of fake UI.
 */
export function PlannedScreen({ title, description, icon: Icon, tone = "blue", phase, summary }: { title: string; description: string; icon: LucideIcon; tone?: Tone; phase: string; summary: string }) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <div className="rounded-xl bg-card shadow-card">
        <EmptyState icon={<Icon />} tone={tone} title={`Coming in ${phase}`} description={summary} action={<ButtonLink href="/home" variant="secondary">Back to Home</ButtonLink>} />
      </div>
    </>
  );
}
