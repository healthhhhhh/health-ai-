import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Chat message bubble. AI messages sit on white cards; user messages use the primary fill. */
export function ChatBubble({ from, children, avatar, footer }: { from: "user" | "assistant"; children: ReactNode; avatar?: ReactNode; footer?: ReactNode }) {
  const isUser = from === "user";
  return (
    <div className={cn("flex items-end gap-2", isUser && "flex-row-reverse")}>
      {!isUser && avatar}
      <div
        className={cn(
          "max-w-[80%] rounded-lg px-4 py-3 text-body",
          isUser ? "rounded-br-sm bg-primary-fill text-on-primary" : "rounded-bl-sm bg-card text-text-primary shadow-card",
        )}
      >
        <span className="sr-only">{isUser ? "You said:" : "HealthMate AI said:"}</span>
        {children}
        {footer && <div className="mt-3">{footer}</div>}
      </div>
    </div>
  );
}
