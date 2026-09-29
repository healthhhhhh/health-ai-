import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { CareError } from "@/features/care/care-error";
import { loadCare } from "@/features/care/data";
import { ProviderForm } from "@/features/care/provider-form";
import { ApiError } from "@/lib/api/server";

export const metadata: Metadata = { title: "Edit care team member" };
export const dynamic = "force-dynamic";

export default async function EditProviderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const care = await loadCare();
  const back = (
    <Link href={`/care/team/${encodeURIComponent(id)}`} className="inline-flex items-center gap-1 self-start text-caption font-semibold text-primary hover:underline">
      <ArrowLeft aria-hidden className="size-4" /> Back
    </Link>
  );
  if (care instanceof ApiError) {
    return (
      <div className="flex max-w-2xl flex-col gap-4">
        {back}
        <CareError error={care} retry={`/care/team/${encodeURIComponent(id)}/edit`} />
      </div>
    );
  }
  const provider = care.providers.find((p) => p.id === id);
  if (!provider) notFound();
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      {back}
      <PageHeader title={`Edit ${provider.name}`} />
      <Card>
        <ProviderForm provider={provider} />
      </Card>
    </div>
  );
}
