import type { ConsentRecord, ConversationDetail, ConversationRecord } from "@healthmate/shared-types";
import type { Metadata } from "next";
import { ChatScreen } from "@/features/chat/chat-screen";
import { getMeta } from "@/lib/api/data";
import { api, ApiError } from "@/lib/api/server";

export const metadata: Metadata = { title: "AI Chat" };

export default async function ChatPage({ searchParams }: { searchParams: Promise<{ c?: string; q?: string }> }) {
  const { c, q } = await searchParams;
  const [conversations, consents, meta, conversation] = await Promise.all([
    api<ConversationRecord[]>("conversations"),
    api<ConsentRecord[]>("me/consents"),
    getMeta(),
    c
      ? api<ConversationDetail>(`conversations/${encodeURIComponent(c)}`).catch((e) => {
          if (e instanceof ApiError && (e.status === 404 || e.status === 400)) return null;
          throw e;
        })
      : Promise.resolve(null),
  ]);
  return (
    <ChatScreen
      key={conversation?.conversation.id ?? "new"}
      conversation={conversation ? { id: conversation.conversation.id, messages: conversation.messages } : null}
      conversations={conversations}
      hasConsent={consents.some((x) => x.kind === "ai_processing" && x.granted)}
      aiAvailable={meta?.ai.available ?? null}
      demo={meta?.ai.demo === true}
      initialQuestion={q?.slice(0, 500)}
    />
  );
}
