/**
 * Illustration registry. The product ships with vector placeholder artwork so it
 * never depends on stock illustrations. To use final artwork, drop files in
 * /public/illustrations and set `src` here — every screen picks it up.
 */
export const illustrations: Record<"mascot", { src?: string; alt: string }> = {
  mascot: { src: undefined, alt: "HealthMate, your AI health assistant" },
};
