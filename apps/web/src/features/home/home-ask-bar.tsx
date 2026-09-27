"use client";

import { useRouter } from "next/navigation";
import { SearchBar } from "@/components/ui/search-bar";

/** On phone widths the top-bar search is hidden, so Home shows its own ask bar (reference: iOS Home). */
export function HomeAskBar() {
  const router = useRouter();
  return (
    <SearchBar
      className="md:hidden"
      onSubmit={(q) => router.push(`/chat?q=${encodeURIComponent(q)}`)}
      onVoice={() => router.push("/chat?mode=voice")}
    />
  );
}
