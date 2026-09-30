import { detectPromptInjection, reviewAssistantText } from "@healthmate/safety";
import { z } from "zod";
import type { AiContentPart, AiEffort, AiMessage, AiTask } from "./ai.types";

/**
 * Per-task generation defaults. `expectedOutputTokens` is only used to
 * estimate a request's cost before it runs (for the monthly limit);
 * `maxOutputTokens` is the hard ceiling sent to the provider.
 */
export interface TaskProfile {
  effort: AiEffort;
  maxOutputTokens: number;
  expectedOutputTokens: number;
}

export const TASK_PROFILES: Record<AiTask, TaskProfile> = {
  health_chat: { effort: "medium", maxOutputTokens: 16_000, expectedOutputTokens: 1_200 },
  complex_health: { effort: "high", maxOutputTokens: 16_000, expectedOutputTokens: 2_500 },
  report_analysis: { effort: "high", maxOutputTokens: 16_000, expectedOutputTokens: 4_000 },
  image_analysis: { effort: "high", maxOutputTokens: 16_000, expectedOutputTokens: 2_500 },
  task_generation: { effort: "low", maxOutputTokens: 4_000, expectedOutputTokens: 800 },
  summarization: { effort: "low", maxOutputTokens: 4_000, expectedOutputTokens: 600 },
};

// ── Output contracts for the tasks that don't have a feature-owned schema yet ──

/**
 * Suggested plan items (tasks and habits only). There is deliberately no
 * medication kind: the AI never adds or changes medications or doses.
 */
export const TaskGenerationSchema = z.strictObject({
  tasks: z
    .array(
      z.strictObject({
        title: z.string().min(1).max(120),
        notes: z.string().max(500).nullable(),
        kind: z.enum(["task", "habit"]),
        time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
      }),
    )
    .max(10),
});
export type GeneratedTasks = z.infer<typeof TaskGenerationSchema>;

export const SummarySchema = z.strictObject({ summary: z.string().min(1).max(2_000) });
export type Summary = z.infer<typeof SummarySchema>;

// ── Response validation after generation ─────────────────────────────────────

/** Issue codes the gateway reports. Only codes, never content. */
export type ValidationIssue = "overconfident_diagnosis" | "dosing_instruction" | "prompt_injection" | "medication_change";

const MEDICATION_CHANGE = /\b(stop|start|increase|decrease|reduce|double|halve|skip|switch)\w*\b[^.]{0,40}\b(medication|medicine|meds|dose|dosage|tablet|pill|insulin)s?\b/i;

const text = (value: unknown): string[] => (typeof value === "string" ? [value] : []);
const texts = (value: unknown): string[] => (Array.isArray(value) ? value.flatMap(text) : []);
const field = (value: unknown, key: string): unknown => (value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined);
const each = (value: unknown, key: string): string[] => (Array.isArray(value) ? value.flatMap((item) => text(field(item, key))) : []);

/** The person-facing text of an answer, per task (what a reader would see). */
function narrative(task: AiTask, data: unknown): { strings: string[]; claimsInjection: boolean } {
  switch (task) {
    case "health_chat":
    case "complex_health":
      return {
        strings: [...text(field(data, "answer")), ...text(field(field(data, "careRecommendation"), "text")), ...text(field(field(data, "followUp"), "question")), ...texts(field(data, "warningSigns"))],
        claimsInjection: false,
      };
    case "report_analysis":
      return {
        strings: [...text(field(data, "summary")), ...each(field(data, "findings"), "explanation"), ...texts(field(data, "suggestedQuestions"))],
        claimsInjection: field(data, "containsInstructionsToAi") === true,
      };
    case "image_analysis":
      return {
        strings: [...texts(field(data, "observations")), ...texts(field(data, "recommendations")), ...texts(field(data, "warningSigns")), ...each(field(data, "possibleCauses"), "name")],
        claimsInjection: field(data, "containsInstructionsToAi") === true,
      };
    case "task_generation":
      return { strings: [...each(field(data, "tasks"), "title"), ...each(field(data, "tasks"), "notes")], claimsInjection: false };
    case "summarization":
      return { strings: text(field(data, "summary")), claimsInjection: false };
  }
}

/**
 * Content checks run on every schema-valid answer: diagnoses stated as fact,
 * dose instructions, instruction-like text echoed from untrusted documents,
 * and (for generated tasks) medication changes. The gateway reports issues;
 * the feature decides whether to rewrite, replace or drop the content.
 */
export function validateTaskOutput(task: AiTask, data: unknown): ValidationIssue[] {
  const { strings, claimsInjection } = narrative(task, data);
  const issues = new Set<ValidationIssue>();
  for (const s of strings) for (const issue of reviewAssistantText(s)) issues.add(issue);
  if ((task === "report_analysis" || task === "image_analysis") && (claimsInjection || strings.some((s) => detectPromptInjection(s)))) issues.add("prompt_injection");
  if (task === "task_generation" && strings.some((s) => MEDICATION_CHANGE.test(s))) issues.add("medication_change");
  return [...issues];
}

// ── Cost estimate before a request runs ──────────────────────────────────────

/** Rough input size: ~4 characters per token for text; fixed or size-based figures for files. */
export function estimateInputTokens(system: string[], messages: AiMessage[]): number {
  const part = (p: AiContentPart): number => {
    switch (p.type) {
      case "text":
        return Math.ceil(p.text.length / 4);
      case "image":
        return 1_600;
      case "pdf":
        // ~2,500 tokens per page; a page is roughly 40 KB of PDF.
        return Math.min(Math.ceil((p.base64.length * 0.75) / 16), 600_000);
    }
  };
  const system_ = system.reduce((n, s) => n + Math.ceil(s.length / 4), 0);
  return system_ + messages.reduce((n, m) => n + (typeof m.content === "string" ? Math.ceil(m.content.length / 4) : m.content.reduce((k, p) => k + part(p), 0)), 0);
}
