/**
 * Deterministic safety rules.
 *
 * STATUS: PENDING CLINICAL REVIEW. These rules implement the escalation
 * categories and test cases in the product specification (§9) plus widely
 * published red-flag lists (e.g. chest pain with breathlessness, FAST stroke
 * signs, anaphylaxis, suicidal intent). They must be reviewed and signed off by
 * a qualified clinician before public launch; do not add clinical rules
 * without that review (CLAUDE.md, spec §19).
 *
 * Rules are data so the same file can be shipped to the iOS app for offline,
 * on-device emergency detection (see scripts/export-rules.mjs).
 */

export type TriageLevel = "emergency" | "urgent" | "routine" | "informational";

export type RuleCategory =
  | "cardiac"
  | "neurological"
  | "respiratory"
  | "allergic"
  | "bleeding"
  | "consciousness"
  | "mental_health_crisis"
  | "poisoning"
  | "abdominal"
  | "infection"
  | "pregnancy";

export interface SymptomRule {
  id: string;
  level: Extract<TriageLevel, "emergency" | "urgent">;
  category: RuleCategory;
  /**
   * Every group must match (AND); within a group any pattern matches (OR).
   * Patterns are case-insensitive regular expression sources.
   */
  allOf: string[][];
  /** Plain-language reason shown to the user. */
  reason: string;
}

export const SYMPTOM_RULES: SymptomRule[] = [
  {
    id: "chest-pain-with-breathlessness",
    level: "emergency",
    category: "cardiac",
    allOf: [
      ["chest (pain|pressure|tightness|heaviness)", "pain in (my|the) chest", "crushing chest"],
      ["short(ness)? of breath", "can'?t (catch my )?breathe?", "cannot breathe", "difficulty breathing", "hard to breathe", "struggling to breathe", "breathless"],
    ],
    reason: "Chest pain together with trouble breathing can be a sign of a heart or lung emergency.",
  },
  {
    id: "chest-pain-radiating",
    level: "emergency",
    category: "cardiac",
    allOf: [
      ["chest (pain|pressure|tightness|heaviness)", "pain in (my|the) chest"],
      ["(left |right )?arm", "jaw", "cold sweat", "sweating", "nause(a|ous)", "vomit"],
    ],
    reason: "Chest pain spreading to the arm or jaw, or with sweating or nausea, can be a sign of a heart attack.",
  },
  {
    id: "stroke-signs",
    level: "emergency",
    category: "neurological",
    allOf: [
      [
        "face (is )?(droop|drooping|numb)",
        "slurred speech",
        "(can'?t|cannot|trouble) (speak|talk)ing?",
        "sudden (weakness|numbness)",
        "(weak|numb)(ness)? (on|in) one side",
        "one side of (my|the) (face|body)",
        "sudden (confusion|vision loss|loss of vision|trouble seeing)",
        "worst headache (of my life|ever)",
        "thunderclap headache",
      ],
    ],
    reason: "Sudden changes in speech, face, strength, vision or a sudden severe headache can be signs of a stroke.",
  },
  {
    id: "severe-breathing-difficulty",
    level: "emergency",
    category: "respiratory",
    allOf: [["can'?t breathe", "cannot breathe", "choking", "blue (lips|face)", "lips (are |turning )?blue", "gasping for (air|breath)"]],
    reason: "Severe difficulty breathing needs immediate help.",
  },
  {
    id: "anaphylaxis",
    level: "emergency",
    category: "allergic",
    allOf: [["(throat|tongue|lips?) (is |are )?(swelling|swollen|closing)", "anaphyla", "allergic reaction.*(breath|throat|swell)"]],
    reason: "Swelling of the throat, tongue or lips can be a severe allergic reaction.",
  },
  {
    id: "severe-bleeding",
    level: "emergency",
    category: "bleeding",
    allOf: [["bleeding (won'?t|will not|doesn'?t|does not) stop", "(heavy|severe|uncontrolled) bleeding", "(coughing|vomiting) (up )?blood", "losing a lot of blood"]],
    reason: "Heavy or uncontrolled bleeding needs urgent in-person care.",
  },
  {
    id: "loss-of-consciousness-or-seizure",
    level: "emergency",
    category: "consciousness",
    allOf: [["passed out", "unconscious", "(having|had) a seizure", "seizing", "fainted and (hit|won'?t wake)", "won'?t wake up", "unresponsive"]],
    reason: "Loss of consciousness or a seizure needs immediate assessment.",
  },
  {
    id: "self-harm-or-suicidal-intent",
    level: "emergency",
    category: "mental_health_crisis",
    allOf: [["suicid", "kill myself", "end my life", "want to die", "self[- ]harm", "hurt myself", "don'?t want to (be alive|live)"]],
    reason: "You deserve support right now. Talking to someone can help.",
  },
  {
    id: "overdose-or-poisoning",
    level: "emergency",
    category: "poisoning",
    allOf: [["overdos", "took too many (pills|tablets)", "swallowed (poison|bleach|chemicals?)", "poison(ed|ing)"]],
    reason: "A possible overdose or poisoning needs immediate help, even if you feel fine now.",
  },
  {
    id: "fever-with-stiff-neck",
    level: "urgent",
    category: "infection",
    allOf: [["fever", "high temperature"], ["stiff neck", "neck (is )?stiff", "rash that doesn'?t fade", "light hurts my eyes"]],
    reason: "Fever with a stiff neck or a rash that doesn't fade should be checked by a clinician today.",
  },
  {
    id: "severe-abdominal-pain",
    level: "urgent",
    category: "abdominal",
    allOf: [["(severe|intense|unbearable|excruciating) (abdominal|stomach|belly) pain", "(abdominal|stomach|belly) pain.*(severe|unbearable)", "blood in (my )?(stool|poo|vomit)", "black (tarry )?stool"]],
    reason: "Severe abdominal pain or blood in stool or vomit should be assessed by a clinician today.",
  },
  {
    id: "pregnancy-bleeding-or-pain",
    level: "urgent",
    category: "pregnancy",
    allOf: [["pregnan"], ["bleeding", "severe (pain|cramp)", "baby (isn'?t|is not|stopped) moving", "reduced movements?"]],
    reason: "Bleeding, severe pain or reduced baby movements in pregnancy should be checked promptly.",
  },
];

/** Requests to start, stop or change a medication or dose. The assistant never does this. */
export const MEDICATION_CHANGE_PATTERNS: string[] = [
  "(should|can|could) i (stop|quit|skip|double|halve|increase|decrease|reduce|change|switch)",
  "(increase|decrease|reduce|double|halve|change|adjust) (my|the) (dose|dosage|medication|meds|prescription)",
  "how (much|many) (mg|milligrams|tablets|pills|of my)",
  "what dose (of|should)",
  "(stop|quit) taking (my )?",
  "(swap|switch) (my )?(medication|meds|prescription)",
];

/** Text that tries to act as instructions inside user-supplied documents or images. */
export const PROMPT_INJECTION_PATTERNS: string[] = [
  "ignore (all |any )?(the )?(previous|prior|above) (instructions|messages|rules)",
  "disregard (all |any )?(the )?(previous|prior|above|system)",
  "you are now",
  "system prompt",
  "new instructions:",
  "act as (a|an) ",
  "reveal (your|the) (prompt|instructions)",
  "<\\s*/?\\s*(system|assistant|instructions?)\\s*>",
];

/** Phrases that present an inference as a certain diagnosis. */
export const OVERCONFIDENT_DIAGNOSIS_PATTERNS: string[] = [
  "\\byou (definitely|certainly|clearly) have\\b",
  "\\bthis is (definitely|certainly|clearly) (a |an )?",
  "\\byour diagnosis is\\b",
  "\\bi (can )?(confirm|diagnose)\\b",
  "\\byou have been diagnosed\\b",
];

/** Dosing directions the assistant must never generate. */
export const DOSING_INSTRUCTION_PATTERNS: string[] = [
  "\\b(take|use|increase|decrease|reduce|double|start|stop)\\b[^.]{0,40}\\b\\d+(\\.\\d+)?\\s?(mg|mcg|µg|g|ml|units?|iu|tablets?|pills?|capsules?|puffs?)\\b",
  "\\b(increase|decrease|reduce|double|halve|stop|skip)\\s+(your|the)\\s+(dose|dosage|medication|meds)\\b",
];
