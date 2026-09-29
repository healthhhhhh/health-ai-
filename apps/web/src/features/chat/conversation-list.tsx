"use client";

import type { ConversationRecord } from "@healthmate/shared-types";
import { Check, MessageSquare, Pencil, RefreshCw, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { formatRelative } from "@/lib/format";
import { deleteConversation, renameConversation } from "./actions";

/** Past conversations: open, rename (inline) or delete (with confirmation). */
export function ConversationList({ conversations, activeId }: { conversations: ConversationRecord[] | null; activeId: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [deleting, setDeleting] = useState<ConversationRecord | null>(null);
  const [pending, start] = useTransition();
  const now = new Date();

  const save = (id: string) =>
    start(async () => {
      const res = await renameConversation(id, title);
      if (res.ok) {
        setEditing(null);
        toast({ tone: "success", title: "Conversation renamed" });
      } else toast({ tone: "error", title: "Couldn't rename it", description: res.error });
    });

  return (
    <Card>
      <h2 className="text-card-title text-text-primary">Conversations</h2>
      {conversations === null ? (
        <div role="alert" className="mt-3 flex flex-col items-start gap-2 text-caption text-text-secondary">
          Your past conversations couldn&apos;t be loaded.
          <Button variant="secondary" size="sm" onClick={() => router.refresh()}>
            <RefreshCw aria-hidden /> Try again
          </Button>
        </div>
      ) : conversations.length === 0 ? (
        <p className="mt-2 flex items-center gap-2 text-caption text-text-secondary">
          <MessageSquare aria-hidden className="size-4" /> Your chats will appear here.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col">
          {conversations.map((c) => (
            <li key={c.id} className="group flex items-center gap-1">
              {editing === c.id ? (
                <form
                  className="flex flex-1 items-center gap-1 py-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    save(c.id);
                  }}
                >
                  <label htmlFor={`rename-${c.id}`} className="sr-only">
                    Conversation name
                  </label>
                  <input
                    id={`rename-${c.id}`}
                    autoFocus
                    value={title}
                    maxLength={80}
                    onChange={(e) => setTitle(e.target.value)}
                    onKeyDown={(e) => e.key === "Escape" && setEditing(null)}
                    className="h-9 min-w-0 flex-1 rounded-md bg-card px-2 text-caption ring-1 ring-primary outline-none"
                  />
                  <button type="submit" aria-label="Save name" disabled={pending} className="rounded-md p-2 text-primary hover:bg-primary-soft">
                    <Check aria-hidden className="size-4" />
                  </button>
                  <button type="button" aria-label="Cancel renaming" onClick={() => setEditing(null)} className="rounded-md p-2 text-text-secondary hover:bg-card-muted">
                    <X aria-hidden className="size-4" />
                  </button>
                </form>
              ) : (
                <>
                  <Link
                    href={`/chat?c=${c.id}`}
                    aria-current={c.id === activeId ? "page" : undefined}
                    className={cn("flex min-w-0 flex-1 flex-col rounded-md px-2 py-2 hover:bg-card-muted", c.id === activeId && "bg-primary-soft")}
                  >
                    <span className={cn("truncate text-caption", c.id === activeId ? "font-semibold text-primary" : "text-text-primary")}>{c.title}</span>
                    <span className="text-xs text-text-secondary">{formatRelative(c.updatedAt, now)}</span>
                  </Link>
                  <button
                    type="button"
                    aria-label={`Rename conversation: ${c.title}`}
                    className="rounded-md p-2 text-text-secondary hover:bg-card-muted hover:text-text-primary"
                    onClick={() => {
                      setTitle(c.title);
                      setEditing(c.id);
                    }}
                  >
                    <Pencil aria-hidden className="size-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete conversation: ${c.title}`}
                    className="rounded-md p-2 text-text-secondary hover:bg-error-soft hover:text-error"
                    onClick={() => setDeleting(c)}
                  >
                    <Trash2 aria-hidden className="size-4" />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Delete this conversation?"
        description={deleting ? `“${deleting.title}” and its messages will be deleted. Facts you chose to remember stay in your profile.` : undefined}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleting) return;
          const res = await deleteConversation(deleting.id);
          if (!res.ok) {
            toast({ tone: "error", title: "Couldn't delete it", description: res.error });
            return;
          }
          toast({ tone: "success", title: "Conversation deleted" });
          if (deleting.id === activeId) router.push("/chat");
          else router.refresh();
        }}
      />
    </Card>
  );
}
