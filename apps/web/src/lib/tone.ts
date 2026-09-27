/** Semantic accent tones used by icon badges, metric cards, timeline items, etc. */
export type Tone = "blue" | "green" | "orange" | "red" | "purple" | "teal";

export const toneClasses: Record<Tone, { fg: string; soft: string; fill: string }> = {
  blue: { fg: "text-primary", soft: "bg-primary-soft", fill: "bg-primary" },
  green: { fg: "text-success", soft: "bg-success-soft", fill: "bg-success" },
  orange: { fg: "text-warning", soft: "bg-warning-soft", fill: "bg-warning" },
  red: { fg: "text-error", soft: "bg-error-soft", fill: "bg-error" },
  purple: { fg: "text-purple", soft: "bg-purple-soft", fill: "bg-purple" },
  teal: { fg: "text-teal", soft: "bg-teal-soft", fill: "bg-teal" },
};
