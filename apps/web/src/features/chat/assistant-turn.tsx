"use client";

import type { AssistantAnswer, ChatMessageRecord } from "@healthmate/shared-types";
import { BrainCircuit, Check, Pill, Stethoscope, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Mascot } from "@/components/illustrations/mascot";
import { Button } from "@/components/ui/button";
import { ChatBubble } from "@/components/ui/chat-bubble";
import { EscalationCard } from "./escalation-card";

const avatar = <Mascot size={32} decorative animated={false} />;

/** One assistant turn: escalation first, then the answer, warning signs, care advice and notices. */
export function AssistantTurn({
  message,
  isLatest,
  saved,
  onAnswer,
  onRemember,
}: {
  message: ChatMessageRecord;
  isLatest: boolean;
  saved: Set<string>;
  onAnswer: (text: string) => void;
  onRemember: (fact: string) => void;
}) {
  const payload = message.payload;
  if (!payload) return <ChatBubble from="assistant" avatar={avatar}>{message.content}</ChatBubble>;
  if (payload.kind === "escalation") return <EscalationCard escalation={payload.escalation} />;
  return <Answer answer={payload} isLatest={isLatest} saved={saved} onAnswer={onAnswer} onRemember={onRemember} />;
}

function Answer({ answer, isLatest, saved, onAnswer, onRemember }: { answer: AssistantAnswer; isLatest: boolean; saved: Set<string>; onAnswer: (t: string) => void; onRemember: (f: string) => void }) {
  return (
    <div className="flex flex-col gap-3">
      {answer.escalation && <EscalationCard escalation={answer.escalation} />}
      <ChatBubble from="assistant" avatar={avatar} footer={answer.followUp ? <FollowUp followUp={answer.followUp} enabled={isLatest} onAnswer={onAnswer} /> : undefined}>
        <p className="whitespace-pre-line">{answer.answer}</p>
      </ChatBubble>
      <div className="flex flex-col gap-2 pl-10">
        {answer.warningSigns.length > 0 && (
          <div className="rounded-md bg-warning-soft p-3">
            <p className="flex items-center gap-2 text-caption font-semibold text-warning">
              <TriangleAlert aria-hidden className="size-4" /> Get help quickly if you notice
            </p>
            <ul className="mt-1 list-disc pl-5 text-caption text-text-primary">
              {answer.warningSigns.map((sign) => (
                <li key={sign}>{sign}</li>
              ))}
            </ul>
          </div>
        )}
        {answer.careRecommendation && (
          <p className="flex gap-2 rounded-md bg-primary-soft p-3 text-caption font-medium text-text-primary">
            <Stethoscope aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
            {answer.careRecommendation.text}
          </p>
        )}
        {answer.notice && (
          <p className="flex gap-2 text-caption text-text-secondary">
            <Pill aria-hidden className="mt-0.5 size-4 shrink-0" />
            {answer.notice}
          </p>
        )}
        {answer.memorySuggestions.map(({ fact }) => (
          <div key={fact} className="flex items-center gap-2 rounded-md bg-purple-soft p-2.5 text-caption">
            <BrainCircuit aria-hidden className="size-4 shrink-0 text-purple" />
            <span className="flex-1 text-text-primary">{fact}</span>
            <Button variant="link" size="sm" className="h-auto" disabled={saved.has(fact)} onClick={() => onRemember(fact)} aria-label={saved.has(fact) ? `Saved: ${fact}` : `Remember: ${fact}`}>
              {saved.has(fact) ? (
                <>
                  <Check aria-hidden /> Saved
                </>
              ) : (
                "Remember"
              )}
            </Button>
          </div>
        ))}
        <p className="text-xs text-text-muted">{answer.safetyAdjusted ? "A safety check replaced part of this answer." : "AI-generated · not a diagnosis"}</p>
      </div>
    </div>
  );
}

function FollowUp({ followUp, enabled, onAnswer }: { followUp: NonNullable<AssistantAnswer["followUp"]>; enabled: boolean; onAnswer: (t: string) => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <fieldset disabled={!enabled} className="flex flex-col gap-2 disabled:opacity-60">
      <legend className="mb-2 font-semibold">{followUp.question}</legend>
      {followUp.allowsMultiple ? (
        <>
          {followUp.options.map((option) => (
            <label key={option} className="flex items-center gap-2">
              <input
                type="checkbox"
                className="size-4 accent-[var(--color-primary)]"
                checked={selected.includes(option)}
                onChange={(e) => setSelected((s) => (e.target.checked ? [...s, option] : s.filter((o) => o !== option)))}
              />
              {option}
            </label>
          ))}
          <Button size="sm" className="self-start" onClick={() => onAnswer(selected.length ? selected.join(", ") : "None of these")}>
            Send
          </Button>
        </>
      ) : (
        <div className="flex flex-wrap gap-2">
          {followUp.options.map((option) => (
            <Button key={option} variant="soft" size="sm" onClick={() => onAnswer(option)}>
              {option}
            </Button>
          ))}
        </div>
      )}
    </fieldset>
  );
}
