"use client";

import { PageError } from "@/components/layout/page-error";

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <PageError reset={reset} />;
}
