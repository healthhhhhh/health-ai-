import {
  DOSING_INSTRUCTION_PATTERNS,
  MEDICATION_CHANGE_PATTERNS,
  OVERCONFIDENT_DIAGNOSIS_PATTERNS,
  PROMPT_INJECTION_PATTERNS,
  SYMPTOM_RULES,
  type RuleCategory,
  type SymptomRule,
  type TriageLevel,
} from "./rules";

export * from "./rules";

const LEVEL_RANK: Record<TriageLevel, number> = { informational: 0, routine: 1, urgent: 2, emergency: 3 };

const compile = (source: string) => new RegExp(source, "i");
const compiledRules = SYMPTOM_RULES.map((rule) => ({ rule, groups: rule.allOf.map((group) => group.map(compile)) }));
const medicationPatterns = MEDICATION_CHANGE_PATTERNS.map(compile);
const injectionPatterns = PROMPT_INJECTION_PATTERNS.map(compile);
const overconfidentPatterns = OVERCONFIDENT_DIAGNOSIS_PATTERNS.map(compile);
const dosingPatterns = DOSING_INSTRUCTION_PATTERNS.map(compile);

/** Normalises curly quotes and whitespace so patterns match what people type on phones. */
export function normalize(text: string): string {
  return text.replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
}

/**
 * Whether a match is negated nearby ("no chest pain", "not short of breath",
 * "denies ..."). Keeps obvious negations from escalating, without trying to be a
 * full language parser. Negation never downgrades self-harm rules.
 */
function isNegated(text: string, index: number): boolean {
  const window = text.slice(Math.max(0, index - 24), index).toLowerCase();
  return /\b(no|not|without|denies|never|don'?t have|doesn'?t have)\s+(any\s+)?$/.test(window);
}

function groupMatches(text: string, patterns: RegExp[], allowNegation: boolean): boolean {
  return patterns.some((pattern) => {
    const match = pattern.exec(text);
    return match !== null && (!allowNegation || !isNegated(text, match.index));
  });
}

export interface TriageResult {
  level: TriageLevel;
  matchedRules: Pick<SymptomRule, "id" | "level" | "category" | "reason">[];
  /** The user is asking to start, stop or change a medication or dose. */
  medicationChangeRequest: boolean;
}

/** Deterministic triage of user text. Runs before (and independently of) any AI model. */
export function triage(input: string): TriageResult {
  const text = normalize(input);
  const matched = compiledRules.filter(({ rule, groups }) =>
    groups.every((group) => groupMatches(text, group, rule.category !== "mental_health_crisis")),
  );
  const level = matched.reduce<TriageLevel>(
    (highest, { rule }) => (LEVEL_RANK[rule.level] > LEVEL_RANK[highest] ? rule.level : highest),
    "routine",
  );
  return {
    level,
    matchedRules: matched.map(({ rule }) => ({ id: rule.id, level: rule.level, category: rule.category, reason: rule.reason })),
    medicationChangeRequest: medicationPatterns.some((p) => p.test(text)),
  };
}

export function isHigherOrEqual(a: TriageLevel, b: TriageLevel): boolean {
  return LEVEL_RANK[a] >= LEVEL_RANK[b];
}

export interface EscalationMessage {
  level: Extract<TriageLevel, "emergency" | "urgent">;
  title: string;
  body: string;
  actions: { kind: "call_emergency" | "crisis_support" | "contact_clinician" | "find_care"; label: string }[];
}

/**
 * Fixed escalation copy. Used instead of a model response for emergencies so
 * urgent guidance never depends on an AI call succeeding.
 */
export function escalationMessage(result: TriageResult): EscalationMessage | null {
  if (result.level !== "emergency" && result.level !== "urgent") return null;
  const categories = new Set<RuleCategory>(result.matchedRules.map((r) => r.category));
  const reasons = result.matchedRules.filter((r) => r.level === result.level).map((r) => r.reason);
  if (result.level === "emergency" && categories.has("mental_health_crisis")) {
    return {
      level: "emergency",
      title: "You don't have to go through this alone",
      body:
        "If you might act on thoughts of harming yourself, call your local emergency number now. You can also contact a crisis line in your country — they're free, confidential and there to listen.",
      actions: [
        { kind: "call_emergency", label: "Call emergency services" },
        { kind: "crisis_support", label: "Find a crisis line" },
      ],
    };
  }
  if (result.level === "emergency") {
    return {
      level: "emergency",
      title: "This could be an emergency",
      body: `${reasons.join(" ")} Call your local emergency number now, or have someone take you to the nearest emergency department. Don't wait to see if it passes.`,
      actions: [
        { kind: "call_emergency", label: "Call emergency services" },
        { kind: "find_care", label: "Find the nearest emergency department" },
      ],
    };
  }
  return {
    level: "urgent",
    title: "Please get checked today",
    body: `${reasons.join(" ")} Contact a doctor or an urgent-care service today. If things get worse, call your local emergency number.`,
    actions: [
      { kind: "contact_clinician", label: "Contact a clinician" },
      { kind: "find_care", label: "Find urgent care" },
    ],
  };
}

export const MEDICATION_CHANGE_NOTICE =
  "HealthMate can't advise starting, stopping or changing a medication or dose. Please talk to the clinician who prescribed it or a pharmacist before making any change.";

/** Detects text that tries to act as instructions (for uploaded documents and images). */
export function detectPromptInjection(input: string): boolean {
  const text = normalize(input);
  return injectionPatterns.some((p) => p.test(text));
}

export type ResponseIssue = "overconfident_diagnosis" | "dosing_instruction";

/** Checks an AI-generated answer before it reaches the user. */
export function reviewAssistantText(input: string): ResponseIssue[] {
  const text = normalize(input);
  const issues: ResponseIssue[] = [];
  if (overconfidentPatterns.some((p) => p.test(text))) issues.push("overconfident_diagnosis");
  if (dosingPatterns.some((p) => p.test(text))) issues.push("dosing_instruction");
  return issues;
}
