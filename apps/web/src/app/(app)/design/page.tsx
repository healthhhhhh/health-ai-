import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { DesignGallery } from "@/features/design/design-gallery";

export const metadata: Metadata = { title: "Design system" };

/** Every shared component and state in one place (review aid; linked from Settings). */
export default function DesignPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Design system" description="Shared components and every screen state, as used across HealthMate." />
      <DesignGallery timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone} />
    </div>
  );
}
