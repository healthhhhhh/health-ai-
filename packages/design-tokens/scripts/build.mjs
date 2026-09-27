#!/usr/bin/env node
/**
 * Generates platform design tokens from tokens.json.
 *
 *   node scripts/build.mjs          write outputs
 *   node scripts/build.mjs --check  exit 1 if outputs are stale (used in CI/tests)
 *
 * Outputs:
 *   apps/web/src/styles/tokens.css                          (Tailwind v4 theme + CSS variables)
 *   apps/ios/HealthMate/DesignSystem/Generated/DesignTokens.swift
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");
const repoRoot = resolve(pkgRoot, "../..");
const tokens = JSON.parse(readFileSync(resolve(pkgRoot, "tokens.json"), "utf8"));

const HEADER = "GENERATED FILE — do not edit. Source: packages/design-tokens/tokens.json (run `npm run tokens`).";

const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

function assertValid() {
  const light = Object.keys(tokens.color);
  const dark = Object.keys(tokens.colorDark);
  const missing = light.filter((k) => !dark.includes(k));
  if (missing.length) throw new Error(`colorDark is missing: ${missing.join(", ")}`);
  for (const [k, v] of [...Object.entries(tokens.color), ...Object.entries(tokens.colorDark)]) {
    if (!/^#[0-9A-Fa-f]{6}$/.test(v.value)) throw new Error(`Invalid hex for ${k}: ${v.value}`);
  }
}

function buildCss() {
  const lines = [`/* ${HEADER} */`, ""];
  lines.push(":root {");
  for (const [k, v] of Object.entries(tokens.color)) lines.push(`  --hm-${kebab(k)}: ${v.value};`);
  lines.push("}", "");
  const darkBlock = Object.entries(tokens.colorDark).map(([k, v]) => `  --hm-${kebab(k)}: ${v.value};`);
  lines.push("@media (prefers-color-scheme: dark) {", "  :root:not([data-theme=\"light\"]) {");
  lines.push(...darkBlock.map((l) => "  " + l));
  lines.push("  }", "}", "");
  lines.push(":root[data-theme=\"dark\"] {", ...darkBlock, "}", "");

  lines.push("@theme inline {");
  for (const k of Object.keys(tokens.color)) lines.push(`  --color-${kebab(k)}: var(--hm-${kebab(k)});`);
  for (const [k, v] of Object.entries(tokens.radius)) lines.push(`  --radius-${k}: ${v.value}px;`);
  for (const [k, v] of Object.entries(tokens.typography)) {
    lines.push(`  --text-${kebab(k)}: ${v.size / 16}rem;`);
    lines.push(`  --text-${kebab(k)}--line-height: ${v.lineHeight / 16}rem;`);
    lines.push(`  --text-${kebab(k)}--letter-spacing: ${v.tracking / 16}rem;`);
    lines.push(`  --text-${kebab(k)}--font-weight: ${v.weight};`);
  }
  for (const [k, v] of Object.entries(tokens.shadow)) {
    const [r, g, b] = hexToRgb(v.color);
    lines.push(`  --shadow-${k}: ${v.x}px ${v.y}px ${v.blur}px rgb(${r} ${g} ${b} / ${v.opacity});`);
  }
  lines.push("}", "");
  return lines.join("\n");
}

function swiftHex(hex) {
  return "0x" + hex.replace("#", "").toUpperCase();
}

function buildSwift() {
  const lines = [`// ${HEADER}`, "", "import SwiftUI", ""];
  lines.push("enum DesignTokens {");
  lines.push("    enum Colors {");
  for (const [k, v] of Object.entries(tokens.color)) {
    const dark = tokens.colorDark[k].value;
    if (v.description) lines.push(`        /// ${v.description}`);
    lines.push(`        static let ${k} = Color(light: ${swiftHex(v.value)}, dark: ${swiftHex(dark)})`);
  }
  lines.push("    }", "");
  lines.push("    enum Radius {");
  for (const [k, v] of Object.entries(tokens.radius)) lines.push(`        static let ${k}: CGFloat = ${v.value}`);
  lines.push("    }", "");
  lines.push("    enum Spacing {");
  for (const [k, v] of Object.entries(tokens.spacing)) lines.push(`        static let ${k}: CGFloat = ${v.value}`);
  lines.push("    }", "");
  lines.push("    struct TypeStyle: Sendable {");
  lines.push("        let size: CGFloat");
  lines.push("        let weight: Int");
  lines.push("        let lineHeight: CGFloat");
  lines.push("        let tracking: CGFloat");
  lines.push("    }", "");
  lines.push("    enum Typography {");
  for (const [k, v] of Object.entries(tokens.typography)) {
    lines.push(`        static let ${k} = TypeStyle(size: ${v.size}, weight: ${v.weight}, lineHeight: ${v.lineHeight}, tracking: ${v.tracking})`);
  }
  lines.push("    }", "");
  lines.push("    struct ShadowStyle: Sendable {");
  lines.push("        let x: CGFloat");
  lines.push("        let y: CGFloat");
  lines.push("        let radius: CGFloat");
  lines.push("        let color: UInt32");
  lines.push("        let opacity: Double");
  lines.push("    }", "");
  lines.push("    enum Shadow {");
  for (const [k, v] of Object.entries(tokens.shadow)) {
    // CSS blur ≈ 2 × SwiftUI shadow radius
    lines.push(`        static let ${k} = ShadowStyle(x: ${v.x}, y: ${v.y}, radius: ${v.blur / 2}, color: ${swiftHex(v.color)}, opacity: ${v.opacity})`);
  }
  lines.push("    }");
  lines.push("}", "");
  return lines.join("\n");
}

assertValid();
const outputs = [
  [resolve(repoRoot, "apps/web/src/styles/tokens.css"), buildCss()],
  [resolve(repoRoot, "apps/ios/HealthMate/DesignSystem/Generated/DesignTokens.swift"), buildSwift()],
];

const check = process.argv.includes("--check");
let stale = [];
for (const [file, content] of outputs) {
  if (check) {
    if (!existsSync(file) || readFileSync(file, "utf8") !== content) stale.push(file);
  } else {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
    console.log(`wrote ${file.replace(repoRoot + "/", "")}`);
  }
}
if (check) {
  if (stale.length) {
    console.error(`Design tokens are stale. Run \`npm run tokens\`.\n${stale.join("\n")}`);
    process.exit(1);
  }
  console.log("Design tokens are up to date.");
}
