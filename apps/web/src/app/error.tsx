"use client";

import { PageError } from "@/components/layout/page-error";

/** Pages outside the signed-in shell (setup, sign-in): same message as `(app)/error.tsx`. */
export default function RootError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="bg-app-gradient min-h-dvh">
      <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
        <PageError reset={reset} />
      </main>
    </div>
  );
}
