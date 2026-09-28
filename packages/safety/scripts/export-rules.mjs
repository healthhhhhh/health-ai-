#!/usr/bin/env node
/**
 * Exports the deterministic safety rules to Swift so the iOS app can detect
 * emergencies on-device, even offline.
 *
 *   node --experimental-strip-types scripts/export-rules.mjs          write
 *   node --experimental-strip-types scripts/export-rules.mjs --check  fail if stale
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const rules = await import(resolve(here, "../src/rules.ts"));
const out = resolve(repoRoot, "apps/ios/Packages/HealthMateCore/Sources/HealthMateCore/Safety/SafetyRules.generated.swift");

const q = (s) => JSON.stringify(s); // JSON string literals are valid Swift string literals for this ASCII-safe content
const arr = (items) => `[${items.map(q).join(", ")}]`;

const lines = [
  "// GENERATED FILE — do not edit. Source: packages/safety/src/rules.ts (run `npm run safety:export`).",
  "// STATUS: pending clinical review — see the source file header.",
  "",
  "enum SafetyRules {",
  "    static let symptomRules: [SymptomRule] = [",
];
for (const r of rules.SYMPTOM_RULES) {
  lines.push("        SymptomRule(");
  lines.push(`            id: ${q(r.id)},`);
  lines.push(`            level: .${r.level},`);
  lines.push(`            category: ${q(r.category)},`);
  lines.push(`            allOf: [${r.allOf.map(arr).join(", ")}],`);
  lines.push(`            reason: ${q(r.reason)}`);
  lines.push("        ),");
}
lines.push("    ]", "");
lines.push(`    static let medicationChangePatterns: [String] = ${arr(rules.MEDICATION_CHANGE_PATTERNS)}`);
lines.push(`    static let promptInjectionPatterns: [String] = ${arr(rules.PROMPT_INJECTION_PATTERNS)}`);
lines.push("}", "");
const content = lines.join("\n");

if (process.argv.includes("--check")) {
  if (!existsSync(out) || readFileSync(out, "utf8") !== content) {
    console.error(`Swift safety rules are stale. Run \`npm run safety:export\`.\n${out}`);
    process.exit(1);
  }
  console.log("Swift safety rules are up to date.");
} else {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, content);
  console.log(`wrote ${out.replace(repoRoot + "/", "")}`);
}
