"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { removeProvider } from "./actions";

export function RemoveProviderButton({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const router = useRouter();
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        <Trash2 aria-hidden /> Remove from care team
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Remove “${name}”?`}
        description="Their details are removed from HealthMate. Appointments with them stay, without the link to this contact."
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          const result = await removeProvider(id);
          if (result.error) toast({ tone: "error", title: "Couldn't remove them", description: result.error });
          else {
            toast({ tone: "success", title: "Removed from your care team" });
            router.push("/care/team");
          }
        }}
      />
    </>
  );
}
