/**
 * Chooses the few remembered facts the AI Health Assistant sees for a
 * question — never the whole history. Pure functions (unit-tested); the
 * database retrievers in MemoryService supply the candidates.
 * See docs/phase2c-plan.md §2.2.
 */
import { describeMemory, type ContextMemory, type Provenance } from "./memory-context";

export type MemoryCategory = "condition" | "medication" | "allergy" | "symptom" | "measurement" | "procedure" | "lifestyle" | "family_history" | "other";
export type TemporalStatus = "current" | "historical" | "superseded";

/** Keyword rules, most specific first. Used for facts without a category and for questions. */
const CATEGORY_RULES: [MemoryCategory, RegExp][] = [
  ["allergy", /\b(allerg\w*|anaphyla\w*|hives|epipen)\b/i],
  ["medication", /\b(medication|medicine|tablet|pill|capsule|dose|dosage|prescri\w*|mg|inhaler|insulin|antibiotic\w*|ibuprofen|paracetamol|acetaminophen|aspirin|statin\w*|metformin|supplement\w*|vitamin\w*|injection)\b|\d\s?(mg|mcg|micrograms?)\b/i],
  ["family_history", /\b(mother|father|mum|mom|dad|sister|brother|grand\w*|family history|runs in (my|the) family)\b/i],
  ["procedure", /\b(surgery|operation|operated|procedure|biopsy|scan|mri|x-ray|xray|ct|colonoscopy|vaccin\w*|jab)\b/i],
  ["condition", /\b(diagnos\w*|asthma|diabetes|diabetic|hypertension|migraine\w*|arthritis|eczema|depression|anxiety|thyroid|copd|epilep\w*|condition|disease|disorder|syndrome)\b/i],
  ["symptom", /\b(pain|ache\w*|headache\w*|nause\w*|dizz\w*|tired\w*|fatigue|cough\w*|fever|rash|swelling|itch\w*|sore|cramp\w*|breathless\w*|palpitation\w*|insomnia)\b/i],
  ["measurement", /\b(blood pressure|bp|glucose|sugar|cholesterol|weight|weigh|heart rate|pulse|bpm|steps|kg|lbs)\b/i],
  ["lifestyle", /\b(sleep\w*|walk\w*|run\w*|exercise|gym|diet|vegetarian|vegan|alcohol|drink\w*|smok\w*|caffeine|coffee|work|stress\w*|screen time|meditat\w*)\b/i],
];

/** The single best category for a fact ("other" when nothing matches). */
export function categorize(text: string): MemoryCategory {
  return CATEGORY_RULES.find(([, re]) => re.test(text))?.[0] ?? "other";
}

/** Every category a question touches (a question can be about a medication *and* a symptom). */
export function questionCategories(text: string): MemoryCategory[] {
  return CATEGORY_RULES.filter(([, re]) => re.test(text)).map(([c]) => c);
}

export function temporalStatus(m: { status: Provenance; endedOn?: string | null }, today: string): TemporalStatus {
  if (m.status === "superseded") return "superseded";
  return m.endedOn && m.endedOn <= today ? "historical" : "current";
}

export interface MemoryCandidate extends ContextMemory {
  id: string;
  category: MemoryCategory | null;
  aiExcluded: boolean;
  /** Cosine similarity 0–1 from the embedding search, when it matched. */
  similarity?: number;
  /** Full-text rank from Postgres, when it matched. */
  textRank?: number;
  /** In a category the question is about. */
  categoryMatch?: boolean;
  /** Only here as one of the most recent confirmed facts. */
  recent?: boolean;
}

export interface SelectedMemory extends MemoryCandidate {
  temporalStatus: Exclude<TemporalStatus, "superseded">;
  score: number;
}

/** How much a fact's source is trusted when choosing context (never used as proof). */
export const PROVENANCE_WEIGHT: Record<Provenance, number> = {
  clinician_provided: 1,
  user_confirmed: 1,
  user_reported: 0.9,
  document_extracted: 0.8,
  healthkit: 0.8,
  ai_inferred: 0.4,
  superseded: 0,
};

const MS_PER_DAY = 86_400_000;
const days = (from: string, to: string) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY;

/** Past facts fade (half-life ~2 years) but never disappear; current facts don't fade. */
export function timeWeight(m: { endedOn?: string | null; occurredOn?: string | null; createdAt: string }, status: TemporalStatus, today: string): number {
  if (status !== "historical") return 1;
  const age = Math.max(0, days(m.endedOn ?? m.occurredOn ?? m.createdAt.slice(0, 10), today));
  return Math.max(0.15, 0.5 ** (age / 730));
}

export function relevance(c: MemoryCandidate): number {
  const text = c.textRank ? c.textRank / (c.textRank + 0.05) : 0;
  return Math.max(c.similarity ?? 0, text, c.categoryMatch ? 0.5 : 0, c.recent ? 0.2 : 0);
}

export const CONTEXT_BUDGET = { maxItems: 12, maxChars: 2400 } as const;

/**
 * Ranks candidates and keeps the best within the budget. Superseded and
 * AI-excluded facts are dropped; an unconfirmed AI inference is kept only when
 * it is actually relevant to the question (not merely recent).
 */
export function selectMemoriesForContext(candidates: MemoryCandidate[], today: string, budget: { maxItems: number; maxChars: number } = CONTEXT_BUDGET): SelectedMemory[] {
  // Merge duplicates from different retrievers, keeping the strongest signals.
  const byId = new Map<string, MemoryCandidate>();
  for (const c of candidates) {
    const seen = byId.get(c.id);
    byId.set(
      c.id,
      seen
        ? {
            ...seen,
            similarity: Math.max(seen.similarity ?? 0, c.similarity ?? 0) || undefined,
            textRank: Math.max(seen.textRank ?? 0, c.textRank ?? 0) || undefined,
            categoryMatch: seen.categoryMatch || c.categoryMatch,
            recent: seen.recent || c.recent,
          }
        : c,
    );
  }
  const scored: SelectedMemory[] = [];
  for (const c of byId.values()) {
    const status = temporalStatus(c, today);
    if (status === "superseded" || c.aiExcluded) continue;
    const rel = relevance(c);
    if (c.status === "ai_inferred" && rel < 0.35) continue;
    const score = rel * PROVENANCE_WEIGHT[c.status] * timeWeight(c, status, today);
    if (score <= 0) continue;
    scored.push({ ...c, temporalStatus: status, score });
  }
  scored.sort((a, b) => b.score - a.score || b.createdAt.localeCompare(a.createdAt));
  const chosen: SelectedMemory[] = [];
  let chars = 0;
  for (const m of scored) {
    if (chosen.length >= budget.maxItems) break;
    const cost = describeMemory(m, today).length + 3;
    if (chars + cost > budget.maxChars) continue;
    chosen.push(m);
    chars += cost;
  }
  return chosen;
}

/** The memory section of the health context: current facts, then past ones, each with source and date. */
export function renderMemoryContext(selected: SelectedMemory[], today: string): string {
  const current = selected.filter((m) => m.temporalStatus === "current");
  const past = selected.filter((m) => m.temporalStatus === "historical");
  const lines = (list: SelectedMemory[]) => list.map((m) => `- ${describeMemory(m, today)}`).join("\n");
  const parts: string[] = [];
  parts.push(current.length ? `Current:\n${lines(current)}` : "Current:\n- none relevant");
  if (past.length) parts.push(`Past (no longer current — use only as history):\n${lines(past)}`);
  return parts.join("\n");
}
