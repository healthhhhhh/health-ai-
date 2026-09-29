import type { Metadata } from "next";
import { ArrowLeft, Plus, Stethoscope } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ProviderCard } from "@/components/ui/provider-card";
import { StateView } from "@/components/ui/state-view";
import { CareError } from "@/features/care/care-error";
import { loadCare } from "@/features/care/data";
import { ApiError } from "@/lib/api/server";

export const metadata: Metadata = { title: "Care team" };
export const dynamic = "force-dynamic";

export default async function CareTeamPage() {
  const care = await loadCare();
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <Link href="/care" className="inline-flex items-center gap-1 self-start text-caption font-semibold text-primary hover:underline">
        <ArrowLeft aria-hidden className="size-4" /> Care
      </Link>
      <PageHeader
        title="Care team"
        description="Your doctors, clinics and pharmacy, with their details in one place. Only you can see this list."
        actions={
          <Link href="/care/team/new" className={buttonVariants({ size: "sm" })}>
            <Plus aria-hidden /> Add to care team
          </Link>
        }
      />
      {care instanceof ApiError ? (
        <CareError error={care} retry="/care/team" />
      ) : care.providers.length === 0 ? (
        <Card>
          <StateView state="empty" icon={<Stethoscope />} title="No one added yet" description="Add your doctor, clinic or pharmacy to have their phone number and address to hand, and link them to appointments." />
        </Card>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[...care.providers]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((p) => (
              <li key={p.id}>
                <ProviderCard name={p.name} specialty={p.specialty} phone={p.phone} address={p.address} href={`/care/team/${p.id}`} className="h-full" />
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
