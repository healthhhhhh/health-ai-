import { FileText } from "lucide-react";
import type { ReactNode } from "react";
import { ButtonLink } from "./button";
import { IconBadge } from "./icon-badge";

export function ReportCard({ fileName, meta, href, status }: { fileName: string; meta: string; href: string; status?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-md bg-card p-3 ring-1 ring-separator">
      <IconBadge icon={<FileText />} tone="blue" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-body font-semibold text-text-primary">{fileName}</p>
        <p className="text-caption text-text-secondary">{meta}</p>
      </div>
      {status}
      <ButtonLink href={href} variant="soft" size="sm" aria-label={`View analysis for ${fileName}`}>
        View Analysis
      </ButtonLink>
    </div>
  );
}
