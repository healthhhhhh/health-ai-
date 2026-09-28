import type { MemoryRecord } from "@healthmate/shared-types";
import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { AddAllergyForm, AddConditionForm, AddMedicationForm, AddMemoryForm, DetailsForm, MemoryRow, RemoveButton } from "@/features/profile/forms";
import { getProfile } from "@/lib/api/data";
import { api } from "@/lib/api/server";

export const metadata: Metadata = { title: "Profile" };

const SOURCE: Record<string, string> = {
  user_reported: "Added by you",
  clinician_provided: "From your clinician",
  document_extracted: "From a report",
};

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const [profile, memories] = await Promise.all([getProfile(), api<MemoryRecord[]>(`memories${q ? `?q=${encodeURIComponent(q.slice(0, 200))}` : ""}`)]);
  const { profile: details, conditions, allergies, medications } = profile;

  return (
    <>
      <PageHeader title="Profile" description="Your health profile and what the AI Health Assistant remembers about you." />
      <div className="grid gap-6 xl:grid-cols-2 [&>*]:min-w-0">
        <div className="flex flex-col gap-6">
          <Card as="section" aria-labelledby="details">
            <h2 id="details" className="mb-4 text-card-title text-text-primary">
              Your details
            </h2>
            <DetailsForm firstName={details.firstName} lastName={details.lastName} dateOfBirth={details.dateOfBirth} />
          </Card>

          <Card as="section" aria-labelledby="conditions">
            <h2 id="conditions" className="text-card-title text-text-primary">
              Conditions
            </h2>
            <ItemList
              empty="No conditions added."
              items={conditions.map((c) => ({ id: c.id, title: c.name, detail: c.notes, source: c.source }))}
              collection="conditions"
            />
            <AddConditionForm />
          </Card>

          <Card as="section" aria-labelledby="allergies">
            <h2 id="allergies" className="text-card-title text-text-primary">
              Allergies
            </h2>
            <ItemList empty="No allergies added." items={allergies.map((a) => ({ id: a.id, title: a.substance, detail: a.reaction, source: a.source }))} collection="allergies" />
            <AddAllergyForm />
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card as="section" aria-labelledby="medications">
            <h2 id="medications" className="text-card-title text-text-primary">
              Medications
            </h2>
            <p className="text-caption text-text-secondary">Instructions are shown exactly as entered. HealthMate never changes a medication or dose — talk to your clinician or pharmacist.</p>
            <ItemList
              empty="No medications added."
              items={medications.map((m) => ({ id: m.id, title: m.name, detail: m.instruction, source: m.source }))}
              collection="medications"
            />
            <AddMedicationForm />
          </Card>

          <Card as="section" aria-labelledby="memory">
            <h2 id="memory" className="text-card-title text-text-primary">
              Health memory
            </h2>
            <p className="text-caption text-text-secondary">What the AI Health Assistant keeps in mind about you. You can confirm or delete anything.</p>
            <form className="mt-3" role="search">
              <label htmlFor="memory-search" className="sr-only">
                Search memories
              </label>
              <input
                id="memory-search"
                name="q"
                type="search"
                defaultValue={q}
                placeholder="Search memories"
                className="h-10 w-full rounded-md bg-card px-3.5 text-body ring-1 ring-separator outline-none focus:ring-2 focus:ring-primary"
              />
            </form>
            {memories.length === 0 ? (
              <p className="py-4 text-caption text-text-secondary">{q ? "No matches." : "Nothing remembered yet. Tap Remember on a suggestion in chat, or add something below."}</p>
            ) : (
              <ul className="divide-y divide-separator">
                {memories.map((m) => (
                  <MemoryRow key={m.id} memory={m} />
                ))}
              </ul>
            )}
            <AddMemoryForm />
          </Card>
        </div>
      </div>
    </>
  );
}

function ItemList({ items, empty, collection }: { items: { id: string; title: string; detail: string | null; source: string }[]; empty: string; collection: "conditions" | "allergies" | "medications" }) {
  if (items.length === 0) return <p className="py-3 text-caption text-text-secondary">{empty}</p>;
  return (
    <ul className="my-2 divide-y divide-separator">
      {items.map((item) => (
        <li key={item.id} className="flex items-start gap-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-body font-semibold text-text-primary">{item.title}</p>
            {item.detail && <p className="text-caption whitespace-pre-line text-text-primary">{item.detail}</p>}
            <p className="text-xs text-text-muted">{SOURCE[item.source] ?? item.source}</p>
          </div>
          <RemoveButton collection={collection} id={item.id} label={item.title} />
        </li>
      ))}
    </ul>
  );
}
