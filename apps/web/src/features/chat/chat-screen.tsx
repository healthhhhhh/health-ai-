"use client";

import type { ChatMessageRecord, ConversationRecord, Escalation } from "@healthmate/shared-types";
import { escalationMessage, triage } from "@healthmate/safety";
import { AlertCircle, CloudOff, FlaskConical, LockKeyhole, MessageSquarePlus, SendHorizontal, WifiOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { Mascot } from "@/components/illustrations/mascot";
import { aiProviderPhrase } from "@/lib/ai-provider";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ChatBubble } from "@/components/ui/chat-bubble";
import { Disclaimer } from "@/components/ui/disclaimer";
import { TypingIndicator } from "@/components/ui/typing-indicator";
import { cn } from "@/lib/cn";
import { rememberFact, sendChatMessage, setConsent } from "./actions";
import { AssistantTurn } from "./assistant-turn";
import { AttachMenu } from "./attach-menu";
import { ConversationList } from "./conversation-list";
import { EscalationCard } from "./escalation-card";

type Item = { type: "user"; id: string; text: string } | { type: "assistant"; message: ChatMessageRecord } | { type: "local"; id: string; escalation: Escalation };

/** Starter questions. Same list on iOS (`ChatWelcome`). */
export const CHAT_SUGGESTIONS = ["I've had a headache since this morning", "Help me understand my blood test", "Tips for sleeping better", "What should I ask my doctor?"];

type SendError = { message: string; retry: string; kind: "offline" | "unavailable" | "error" };

function itemsFrom(messages: ChatMessageRecord[]): Item[] {
  return messages.map((m) => (m.role === "user" ? { type: "user", id: m.id, text: m.content } : { type: "assistant", message: m }));
}

/**
 * What's typed in a new chat when it gets its id. The page is keyed by the conversation, so it
 * remounts once the URL becomes /chat?c=<id>; this carries the unsent text across that remount
 * (only into the same conversation). It mirrors that conversation's draft, so a sent message clears it.
 */
let carriedDraft: { conversationId: string; draft: string } | null = null;

export function ChatScreen({
  conversation,
  conversations,
  hasConsent,
  aiAvailable,
  demo,
  initialQuestion,
  missingConversation = false,
  aiRecipients,
}: {
  conversation: { id: string; messages: ChatMessageRecord[] } | null;
  /** Null when the list couldn't be loaded (the chat itself still works). */
  conversations: ConversationRecord[] | null;
  hasConsent: boolean;
  aiAvailable: boolean | null;
  /** "preview": Phase 1 sample responses; "demo": scripted demo server. */
  demo: "preview" | "demo" | null;
  initialQuestion?: string;
  /** The requested conversation no longer exists. */
  missingConversation?: boolean;
  /** Outside AI companies that receive data (`/v1/meta`), named in the consent gate. */
  aiRecipients?: string[];
}) {
  const router = useRouter();
  const [conversationId, setConversationId] = useState(conversation?.id ?? null);
  const [items, setItems] = useState<Item[]>(() => itemsFrom(conversation?.messages ?? []));
  const [draft, setDraft] = useState(() => (carriedDraft && carriedDraft.conversationId === conversation?.id ? carriedDraft.draft : (initialQuestion ?? "")));
  // The latest draft, for the moment a new chat gets its id (read in the send callback, not in render).
  const draftRef = useRef(draft);
  /** Set when this screen's new chat gets its id, before that state update has rendered. */
  const createdIdRef = useRef<string | null>(null);
  useEffect(() => {
    draftRef.current = draft;
    if (carriedDraft && carriedDraft.conversationId === (conversationId ?? createdIdRef.current)) carriedDraft.draft = draft;
  }, [draft, conversationId]);
  const [error, setError] = useState<SendError | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [consentPending, startConsent] = useTransition();
  const bottom = useRef<HTMLDivElement>(null);
  const unavailable = aiAvailable === false;

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "end" });
  }, [items.length, pending, error]);

  const send = (raw: string) => {
    const text = raw.trim();
    if (!text || pending) return;
    setError(null);
    const localId = crypto.randomUUID();
    const next: Item[] = [{ type: "user", id: localId, text }];
    // Deterministic safety check first: emergency guidance appears instantly, even without AI, consent or a connection.
    const result = triage(text);
    const escalation = result.level === "emergency" ? escalationMessage(result) : null;
    if (escalation) next.push({ type: "local", id: localId, escalation });
    setItems((current) => [...current, ...next]);
    setDraft("");
    if (!hasConsent) return;
    if (unavailable) {
      setError({ kind: "unavailable", message: "AI answers are unavailable right now, so this message wasn't sent. Emergency guidance still works.", retry: text });
      return;
    }

    startTransition(async () => {
      const res = await sendChatMessage(conversationId, text).catch(() => ({ ok: false as const, error: "The message couldn't be sent. Please try again.", offline: false }));
      if (!res.ok) {
        setError({ kind: res.offline ? "offline" : "error", message: res.offline ? "You're offline, so your message wasn't sent." : res.error, retry: text });
        return;
      }
      if (!conversationId) {
        setConversationId(res.data.conversationId);
        createdIdRef.current = res.data.conversationId;
        carriedDraft = { conversationId: res.data.conversationId, draft: draftRef.current };
        window.history.replaceState(null, "", `/chat?c=${res.data.conversationId}`);
        router.refresh(); // the new conversation appears in the list
      }
      const replies = res.data.messages.filter((m) => m.role === "assistant");
      setItems((current) => {
        // The server's escalation replaces the local one so it isn't shown twice.
        const serverEscalated = replies.some((m) => m.payload?.kind === "escalation");
        const kept = serverEscalated ? current.filter((i) => !(i.type === "local" && i.id === localId)) : current;
        return [...kept, ...replies.map((message): Item => ({ type: "assistant", message }))];
      });
    });
  };

  const retry = () => {
    if (!error) return;
    const text = error.retry;
    setItems((current) => {
      const last = current.at(-1);
      return last?.type === "user" && last.text === text ? current.slice(0, -1) : current;
    });
    send(text);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send(draft);
  };

  const remember = async (fact: string) => {
    const res = await rememberFact(fact, conversationId);
    if (res.ok) setSaved((s) => new Set(s).add(fact));
    else setError({ kind: res.offline ? "offline" : "error", message: res.error, retry: "" });
  };

  const allow = () =>
    startConsent(async () => {
      const res = await setConsent("ai_processing", true);
      if (res.ok) router.refresh();
      else setError({ kind: res.offline ? "offline" : "error", message: res.error, retry: "" });
    });

  const status = unavailable ? "AI answers unavailable" : demo === "preview" ? "Sample answers" : demo ? "Demo answers" : aiAvailable ? "Online" : "Connecting…";
  const lastAssistant = [...items].reverse().find((i) => i.type === "assistant");

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_300px] [&>*]:min-w-0">
      <Card padded={false} className="flex min-h-[70dvh] flex-col">
        <header className="flex items-center gap-3 border-b border-separator px-5 py-3">
          <Mascot size={36} decorative animated={false} />
          <div>
            <h1 className="text-card-title text-text-primary">AI Health Assistant</h1>
            <p className="flex items-center gap-1.5 text-xs text-text-secondary">
              <span aria-hidden className={cn("size-2 rounded-full", unavailable ? "bg-warning" : aiAvailable ? "bg-success" : "bg-text-muted")} />
              {status}
            </p>
          </div>
          {items.length > 0 && (
            <ButtonLink href="/chat" variant="ghost" size="sm" className="ml-auto">
              <MessageSquarePlus aria-hidden /> New chat
            </ButtonLink>
          )}
        </header>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-5" aria-live="polite">
          {demo && (
            <p className="flex items-start gap-2 rounded-md bg-warning-soft p-3 text-caption font-medium text-text-primary">
              <FlaskConical aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
              {demo === "preview" ? "Preview mode: answers are sample responses, not a real AI and not medical advice." : "Demo server: answers are scripted examples, not real AI."}
            </p>
          )}
          {missingConversation && (
            <p role="status" className="flex items-start gap-2 rounded-md bg-card-muted p-3 text-caption text-text-secondary">
              <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
              That conversation was deleted or isn&apos;t available. You can start a new one below.
            </p>
          )}
          {unavailable && hasConsent && (
            <div role="status" className="flex items-start gap-3 rounded-lg bg-warning-soft p-4">
              <CloudOff aria-hidden className="mt-0.5 size-5 shrink-0 text-warning" />
              <div>
                <p className="text-body font-semibold text-text-primary">AI answers are unavailable right now</p>
                <p className="text-caption text-text-secondary">
                  You can still read past conversations, and emergency guidance still appears instantly. Please try again later.
                </p>
              </div>
            </div>
          )}
          {!hasConsent && (
            <div className="rounded-lg bg-primary-soft p-5">
              <h2 className="flex items-center gap-2 text-section-heading text-text-primary">
                <LockKeyhole aria-hidden className="size-5 text-primary" /> Before we start
              </h2>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-caption text-text-secondary">
                <li>Your messages, plus the profile details and memories you&apos;ve saved, are sent to {aiProviderPhrase(aiRecipients)} to write each answer.</li>
                <li>You can delete conversations or your whole account at any time.</li>
                <li>Answers are general information, not a diagnosis. In an emergency, call your local emergency number.</li>
              </ul>
              <Button className="mt-4" onClick={allow} disabled={consentPending}>
                {consentPending ? "Saving…" : "Allow and continue"}
              </Button>
              <p className="mt-2 text-xs text-text-muted">You can turn this off in Settings.</p>
            </div>
          )}
          {hasConsent && items.length === 0 && (
            <>
              <ChatBubble from="assistant" avatar={<Mascot size={32} decorative animated={false} />}>
                Hi! I&apos;m your AI Health Assistant. Tell me what&apos;s going on and I&apos;ll ask a few questions, explain things in plain language and let you know when to see a
                professional.
              </ChatBubble>
              <div className="flex flex-wrap gap-2 pl-10" role="group" aria-label="Suggested questions">
                {CHAT_SUGGESTIONS.map((s) => (
                  <Button key={s} variant="soft" size="sm" onClick={() => send(s)} disabled={unavailable}>
                    {s}
                  </Button>
                ))}
              </div>
            </>
          )}
          {items.map((item) =>
            item.type === "user" ? (
              <ChatBubble key={`u-${item.id}`} from="user">
                {item.text}
              </ChatBubble>
            ) : item.type === "local" ? (
              <EscalationCard key={`e-${item.id}`} escalation={item.escalation} />
            ) : (
              <AssistantTurn
                key={`a-${item.message.id}`}
                message={item.message}
                isLatest={item === lastAssistant && !pending}
                saved={saved}
                onAnswer={send}
                onRemember={remember}
                sample={demo === "preview"}
              />
            ),
          )}
          {pending && <TypingIndicator className="ml-10 self-start" />}
          {error && (
            <div role="alert" className="flex items-center gap-3 rounded-md bg-error-soft p-3 text-caption text-text-primary">
              {error.kind === "offline" ? <WifiOff aria-hidden className="size-4 shrink-0 text-error" /> : <AlertCircle aria-hidden className="size-4 shrink-0 text-error" />}
              <span className="flex-1">{error.message}</span>
              {error.retry && (
                <Button variant="link" size="sm" className="h-auto" onClick={retry}>
                  {error.kind === "unavailable" ? "Try again" : "Retry"}
                </Button>
              )}
            </div>
          )}
          <div ref={bottom} />
        </div>

        <form onSubmit={onSubmit} className="border-t border-separator p-4">
          <div className="flex items-end gap-2">
            <AttachMenu />
            <label htmlFor="chat-message" className="sr-only">
              Message
            </label>
            <textarea
              id="chat-message"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(draft);
                }
              }}
              rows={1}
              maxLength={4000}
              placeholder="Type your message…"
              className="max-h-40 min-h-11 flex-1 resize-none rounded-lg bg-card px-4 py-2.5 text-body ring-1 ring-separator outline-none focus:ring-2 focus:ring-primary"
            />
            <Button type="submit" aria-label="Send" disabled={!draft.trim() || pending} className="size-11 px-0">
              <SendHorizontal aria-hidden />
            </Button>
          </div>
          <p className="mt-2 text-center text-xs text-text-muted">
            {demo === "preview" ? "Sample responses in Preview mode, not a diagnosis." : "AI-generated information, not a diagnosis."}
          </p>
        </form>
      </Card>

      <aside aria-label="Past conversations" className="flex flex-col gap-4">
        <ConversationList conversations={conversations} activeId={conversationId} />
        <Disclaimer />
      </aside>
    </div>
  );
}
