// GENERATED FILE — do not edit. Source: packages/safety/src/rules.ts (run `npm run safety:export`).
// STATUS: pending clinical review — see the source file header.

enum SafetyRules {
    static let symptomRules: [SymptomRule] = [
        SymptomRule(
            id: "chest-pain-with-breathlessness",
            level: .emergency,
            category: "cardiac",
            allOf: [["chest (pain|pressure|tightness|heaviness)", "pain in (my|the) chest", "crushing chest"], ["short(ness)? of breath", "can'?t (catch my )?breathe?", "cannot breathe", "difficulty breathing", "hard to breathe", "struggling to breathe", "breathless"]],
            reason: "Chest pain together with trouble breathing can be a sign of a heart or lung emergency."
        ),
        SymptomRule(
            id: "chest-pain-radiating",
            level: .emergency,
            category: "cardiac",
            allOf: [["chest (pain|pressure|tightness|heaviness)", "pain in (my|the) chest"], ["(left |right )?arm", "jaw", "cold sweat", "sweating", "nause(a|ous)", "vomit"]],
            reason: "Chest pain spreading to the arm or jaw, or with sweating or nausea, can be a sign of a heart attack."
        ),
        SymptomRule(
            id: "stroke-signs",
            level: .emergency,
            category: "neurological",
            allOf: [["face (is )?(droop|drooping|numb)", "slurred speech", "(can'?t|cannot|trouble) (speak|talk)ing?", "sudden (weakness|numbness)", "(weak|numb)(ness)? (on|in) one side", "one side of (my|the) (face|body)", "sudden (confusion|vision loss|loss of vision|trouble seeing)", "worst headache (of my life|ever)", "thunderclap headache"]],
            reason: "Sudden changes in speech, face, strength, vision or a sudden severe headache can be signs of a stroke."
        ),
        SymptomRule(
            id: "severe-breathing-difficulty",
            level: .emergency,
            category: "respiratory",
            allOf: [["can'?t breathe", "cannot breathe", "choking", "blue (lips|face)", "lips (are |turning )?blue", "gasping for (air|breath)"]],
            reason: "Severe difficulty breathing needs immediate help."
        ),
        SymptomRule(
            id: "anaphylaxis",
            level: .emergency,
            category: "allergic",
            allOf: [["(throat|tongue|lips?) (is |are )?(swelling|swollen|closing)", "anaphyla", "allergic reaction.*(breath|throat|swell)"]],
            reason: "Swelling of the throat, tongue or lips can be a severe allergic reaction."
        ),
        SymptomRule(
            id: "severe-bleeding",
            level: .emergency,
            category: "bleeding",
            allOf: [["bleeding (won'?t|will not|doesn'?t|does not) stop", "(heavy|severe|uncontrolled) bleeding", "(coughing|vomiting) (up )?blood", "losing a lot of blood"]],
            reason: "Heavy or uncontrolled bleeding needs urgent in-person care."
        ),
        SymptomRule(
            id: "loss-of-consciousness-or-seizure",
            level: .emergency,
            category: "consciousness",
            allOf: [["passed out", "unconscious", "(having|had) a seizure", "seizing", "fainted and (hit|won'?t wake)", "won'?t wake up", "unresponsive"]],
            reason: "Loss of consciousness or a seizure needs immediate assessment."
        ),
        SymptomRule(
            id: "self-harm-or-suicidal-intent",
            level: .emergency,
            category: "mental_health_crisis",
            allOf: [["suicid", "kill myself", "end my life", "want to die", "self[- ]harm", "hurt myself", "don'?t want to (be alive|live)"]],
            reason: "You deserve support right now. Talking to someone can help."
        ),
        SymptomRule(
            id: "overdose-or-poisoning",
            level: .emergency,
            category: "poisoning",
            allOf: [["overdos", "took too many (pills|tablets)", "swallowed (poison|bleach|chemicals?)", "poison(ed|ing)"]],
            reason: "A possible overdose or poisoning needs immediate help, even if you feel fine now."
        ),
        SymptomRule(
            id: "fever-with-stiff-neck",
            level: .urgent,
            category: "infection",
            allOf: [["fever", "high temperature"], ["stiff neck", "neck (is )?stiff", "rash that doesn'?t fade", "light hurts my eyes"]],
            reason: "Fever with a stiff neck or a rash that doesn't fade should be checked by a clinician today."
        ),
        SymptomRule(
            id: "severe-abdominal-pain",
            level: .urgent,
            category: "abdominal",
            allOf: [["(severe|intense|unbearable|excruciating) (abdominal|stomach|belly) pain", "(abdominal|stomach|belly) pain.*(severe|unbearable)", "blood in (my )?(stool|poo|vomit)", "black (tarry )?stool"]],
            reason: "Severe abdominal pain or blood in stool or vomit should be assessed by a clinician today."
        ),
        SymptomRule(
            id: "pregnancy-bleeding-or-pain",
            level: .urgent,
            category: "pregnancy",
            allOf: [["pregnan"], ["bleeding", "severe (pain|cramp)", "baby (isn'?t|is not|stopped) moving", "reduced movements?"]],
            reason: "Bleeding, severe pain or reduced baby movements in pregnancy should be checked promptly."
        ),
    ]

    static let medicationChangePatterns: [String] = ["(should|can|could) i (stop|quit|skip|double|halve|increase|decrease|reduce|change|switch)", "(increase|decrease|reduce|double|halve|change|adjust) (my|the) (dose|dosage|medication|meds|prescription)", "how (much|many) (mg|milligrams|tablets|pills|of my)", "what dose (of|should)", "(stop|quit) taking (my )?", "(swap|switch) (my )?(medication|meds|prescription)"]
    static let promptInjectionPatterns: [String] = ["ignore (all |any )?(the )?(previous|prior|above) (instructions|messages|rules)", "disregard (all |any )?(the )?(previous|prior|above|system)", "you are now", "system prompt", "new instructions:", "act as (a|an) ", "reveal (your|the) (prompt|instructions)", "<\\s*/?\\s*(system|assistant|instructions?)\\s*>"]
}
