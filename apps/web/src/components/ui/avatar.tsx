import { cn } from "@/lib/cn";

const sizes = { sm: "size-8 text-xs", md: "size-10 text-sm", lg: "size-14 text-lg" };

/** Initials avatar. Swap for an <img> once profile photos are supported by the API. */
export function Avatar({ name, size = "md", className }: { name: string; size?: keyof typeof sizes; className?: string }) {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
  return (
    <span
      role="img"
      aria-label={name}
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary-tint to-purple-soft font-semibold text-primary ring-2 ring-card", sizes[size], className)}
    >
      {initials}
    </span>
  );
}
