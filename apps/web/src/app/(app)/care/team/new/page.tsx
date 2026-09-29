import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ProviderForm } from "@/features/care/provider-form";

export const metadata: Metadata = { title: "Add to care team" };

export default function NewProviderPage() {
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <Link href="/care/team" className="inline-flex items-center gap-1 self-start text-caption font-semibold text-primary hover:underline">
        <ArrowLeft aria-hidden className="size-4" /> Care team
      </Link>
      <PageHeader title="Add to care team" description="A doctor, clinic, pharmacy or anyone else involved in your care." />
      <Card>
        <ProviderForm />
      </Card>
    </div>
  );
}
