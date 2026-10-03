"use client";

import { LockKeyhole } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { setConsent } from "@/features/chat/actions";
import { aiProviderPhrase } from "@/lib/ai-provider";

/** `aiRecipients`: outside AI companies that receive the files (`/v1/meta`), named in the text. */
export function DocumentsConsent({ aiRecipients }: { aiRecipients?: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="rounded-lg bg-primary-soft p-5">
      <p className="flex items-center gap-2 font-semibold text-text-primary">
        <LockKeyhole aria-hidden className="size-5 text-primary" /> Before you upload
      </p>
      <p className="mt-2 text-caption text-text-secondary">
        Files you upload are stored in your account and sent to {aiProviderPhrase(aiRecipients)} to create a summary. You can delete any file at any time. Summaries are general
        information, not a diagnosis.
      </p>
      {error && (
        <p role="alert" className="mt-2 text-caption text-error">
          {error}
        </p>
      )}
      <Button
        className="mt-4"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await setConsent("document_processing", true);
            if (res.ok) router.refresh();
            else setError(res.error);
          })
        }
      >
        {pending ? "Saving…" : "Allow and continue"}
      </Button>
    </div>
  );
}
