import type { ConsentRecord, ConversationDetail, ConversationRecord } from "@healthmate/shared-types";
import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { StateView } from "@/components/ui/state-view";
import { ChatScreen } from "@/features/chat/chat-screen";
import { getMeta } from "@/lib/api/data";
import { api, ApiError } from "@/lib/api/server";

export const metadata: Metadata = { title: "AI Chat" };

/** A failed request becomes a value (so the page can show a state); sign-in redirects still propagate. */
const orError = (error: unknown) => {
  if (error instanceof ApiError && error.status !== 401) return error;
  throw error;
};

export default async function ChatPage({ searchParams }: { searchParams: Promise<{ c?: string; q?: string }> }) {
  const { c, q } = await searchParams;
  const [conversations, consents, meta, conversation] = await Promise.all([
    api<ConversationRecord[]>("conversations").catch(orError),
    api<ConsentRecord[]>("me/consents").catch(orError),
    getMeta(),
    c
      ? api<ConversationDetail>(`conversations/${encodeURIComponent(c)}`).catch((e) => {
          if (e instanceof ApiError && (e.status === 404 || e.status === 400)) return null;
          return orError(e);
        })
      : Promise.resolve(null),
  ]);

  // Without consents we can't tell whether the assistant may be used, so show the state instead of guessing.
  if (consents instanceof ApiError) {
    const offline = consents.code === "network";
    return (
      <Card>
        <StateView
          state={offline ? "offline" : "error"}
          title={offline ? undefined : "The AI Health Assistant couldn't load"}
          description={offline ? undefined : "Please try again in a moment. In an emergency, call your local emergency number."}
          action={
            <a href={c ? `/chat?c=${encodeURIComponent(c)}` : "/chat"} className="text-caption font-semibold text-primary hover:underline">
              Try again
            </a>
          }
        />
      </Card>
    );
  }

  const detail = conversation instanceof ApiError ? null : conversation;
  return (
    <ChatScreen
      key={detail?.conversation.id ?? "new"}
      conversation={detail ? { id: detail.conversation.id, messages: detail.messages } : null}
      conversations={conversations instanceof ApiError ? null : conversations}
      hasConsent={consents.some((x) => x.kind === "ai_processing" && x.granted)}
      aiAvailable={meta?.ai.available ?? null}
      demo={meta?.preview ? "preview" : meta?.ai.demo === true ? "demo" : null}
      initialQuestion={q?.slice(0, 500)}
      missingConversation={Boolean(c) && conversation === null}
      aiRecipients={meta?.ai.recipients}
    />
  );
}
