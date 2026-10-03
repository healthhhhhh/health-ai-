"use server";

import type { ChatMessageRecord, ConsentKind, ConversationDetail, ConversationRecord } from "@healthmate/shared-types";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { api, ApiError, errorMessage } from "@/lib/api/server";

/** `offline`: the request never reached the server, so it's safe to retry as-is. */
type Result<T> = { ok: true; data: T } | { ok: false; error: string; offline?: boolean };

async function attempt<T>(work: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await work() };
  } catch (error) {
    unstable_rethrow(error);
    const offline = error instanceof ApiError && error.code === "network";
    return { ok: false, error: offline ? "You're offline. Check your connection and try again." : errorMessage(error), offline };
  }
}

const clean = (text: unknown) => (typeof text === "string" ? text.trim().slice(0, 4000) : "");

/** Sends a message; starts a conversation when there isn't one yet. */
export async function sendChatMessage(conversationId: string | null, text: string): Promise<Result<{ conversationId: string; messages: ChatMessageRecord[] }>> {
  const message = clean(text);
  if (!message) return { ok: false, error: "Type a message first." };
  return attempt(async () => {
    if (conversationId) {
      const res = await api<{ messages: ChatMessageRecord[] }>(`conversations/${encodeURIComponent(conversationId)}/messages`, { method: "POST", json: { message } });
      return { conversationId, messages: res.messages };
    }
    // No revalidatePath here: the chat screen refreshes itself once it has the new address. Doing both
    // raced, and Next.js sometimes reloaded the whole page.
    const res = await api<ConversationDetail>("conversations", { method: "POST", json: { message } });
    return { conversationId: res.conversation.id, messages: res.messages };
  });
}

export async function setConsent(kind: ConsentKind, granted: boolean): Promise<Result<null>> {
  if (!["ai_processing", "document_processing", "health_data_sync", "voice"].includes(kind)) return { ok: false, error: "Unknown setting." };
  return attempt(async () => {
    await api("me/consents", { method: "POST", json: { kind, granted } });
    revalidatePath("/", "layout");
    return null;
  });
}

/** Saves a fact the person explicitly confirmed. Never automatic. */
export async function rememberFact(fact: string, conversationId: string | null): Promise<Result<null>> {
  const value = clean(fact).slice(0, 500);
  if (!value) return { ok: false, error: "Nothing to save." };
  return attempt(async () => {
    await api("memories", {
      method: "POST",
      json: { fact: value, status: "user_confirmed", source: conversationId ? "user_conversation" : "user_entry", sourceId: conversationId },
    });
    return null;
  });
}

export async function renameConversation(id: string, title: string): Promise<Result<null>> {
  const value = clean(title).slice(0, 80);
  if (!value) return { ok: false, error: "Give the conversation a name." };
  return attempt(async () => {
    await api(`conversations/${encodeURIComponent(id)}`, { method: "PATCH", json: { title: value } });
    revalidatePath("/chat");
    return null;
  });
}

export async function deleteConversation(id: string): Promise<Result<null>> {
  return attempt(async () => {
    await api(`conversations/${encodeURIComponent(id)}`, { method: "DELETE" });
    revalidatePath("/chat");
    return null;
  });
}

export async function listConversations(): Promise<ConversationRecord[]> {
  return api<ConversationRecord[]>("conversations");
}
