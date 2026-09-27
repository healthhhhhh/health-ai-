"use client";

import { Mic, Search } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { cn } from "@/lib/cn";

interface SearchBarProps {
  placeholder?: string;
  label?: string;
  onSubmit?: (query: string) => void;
  onVoice?: () => void;
  shortcutHint?: string;
  className?: string;
}

/** The "Ask your AI health assistant" bar used in the home screen and web top bar. */
export function SearchBar({ placeholder = "Ask your AI health assistant anything…", label = "Ask your AI health assistant", onSubmit, onVoice, shortcutHint, className }: SearchBarProps) {
  const id = useId();
  const [query, setQuery] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (q) onSubmit?.(q);
  };
  return (
    <form role="search" onSubmit={submit} className={cn("flex h-12 items-center gap-3 rounded-md bg-card px-4 shadow-card ring-1 ring-separator/60 focus-within:ring-2 focus-within:ring-primary", className)}>
      <Search aria-hidden className="size-5 shrink-0 text-text-muted" />
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        id={id}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        className="h-full min-w-0 flex-1 bg-transparent text-body text-text-primary placeholder:text-text-muted focus:outline-none"
      />
      {shortcutHint && (
        <kbd aria-hidden className="hidden rounded-sm bg-card-muted px-1.5 py-0.5 font-sans text-xs text-text-muted ring-1 ring-separator sm:inline">
          {shortcutHint}
        </kbd>
      )}
      {onVoice && (
        <button type="button" onClick={onVoice} aria-label="Ask by voice" className="rounded-full p-1 text-text-secondary hover:text-primary">
          <Mic aria-hidden className="size-5" />
        </button>
      )}
    </form>
  );
}
