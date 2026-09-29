"use client";

import { Check, Copy, Download, MessageCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/** Suggested questions for a clinician, ready to copy, save or take to the AI Health Assistant. */
export function QuestionsCard({ questions, text, filename, askHref }: { questions: string[]; text: string; filename: string; askHref: string }) {
  const [copied, setCopied] = useState<"ok" | "failed" | null>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("ok");
    } catch {
      setCopied("failed");
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `Questions - ${filename.replace(/\.[^.]+$/, "")}.txt` });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card as="section" aria-labelledby="questions">
      <h2 id="questions" className="text-card-title text-text-primary">
        Questions to ask your doctor
      </h2>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-body text-text-primary">
        {questions.map((q) => (
          <li key={q}>{q}</li>
        ))}
      </ol>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={copy}>
          {copied === "ok" ? <Check aria-hidden /> : <Copy aria-hidden />} {copied === "ok" ? "Copied" : "Copy questions"}
        </Button>
        <Button variant="secondary" size="sm" onClick={download}>
          <Download aria-hidden /> Save as text
        </Button>
        <Link href={askHref} className={buttonVariants({ variant: "soft", size: "sm" })}>
          <MessageCircle aria-hidden /> Ask the AI Health Assistant
        </Link>
      </div>
      <p aria-live="polite" className="mt-2 text-caption text-text-secondary empty:hidden">
        {copied === "ok" ? "Questions copied." : copied === "failed" ? "Couldn't copy here — use Save as text instead." : ""}
      </p>
    </Card>
  );
}
