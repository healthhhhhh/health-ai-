import Link from "next/link";
import { Card } from "@/components/ui/card";
import { StateView } from "@/components/ui/state-view";
import type { ApiError } from "@/lib/api/server";

/** The plan couldn't load: offline or error, with a retry. */
export function PlanError({ error, retry }: { error: ApiError; retry: string }) {
  return (
    <Card>
      <StateView
        state={error.code === "network" ? "offline" : "error"}
        title={error.code === "network" ? undefined : "Your plan couldn't load"}
        action={
          <Link href={retry} prefetch={false} className="text-caption font-semibold text-primary hover:underline">
            Try again
          </Link>
        }
      />
    </Card>
  );
}
