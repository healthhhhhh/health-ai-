"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { deleteDocument } from "./actions";

export function DeleteDocumentButton({ id }: { id: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  if (!confirming)
    return (
      <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
        <Trash2 aria-hidden /> Delete
      </Button>
    );
  return (
    <div className="flex items-center gap-2" role="group" aria-label="Confirm delete">
      <span className="text-caption text-text-secondary">Delete this file and its summary?</span>
      <Button
        variant="secondary"
        size="sm"
        disabled={pending}
        className="text-error"
        onClick={() =>
          start(async () => {
            const res = await deleteDocument(id);
            if (!res.error) router.push("/reports");
          })
        }
      >
        Delete
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
        Cancel
      </Button>
    </div>
  );
}
