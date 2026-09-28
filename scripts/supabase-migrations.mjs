#!/usr/bin/env node
// Mirrors services/api/migrations (the single source of truth) into
// supabase/migrations with Supabase CLI version names, so `supabase db push`
// / `supabase start` apply exactly the same SQL as the API's own runner.
//   node scripts/supabase-migrations.mjs          write the files
//   node scripts/supabase-migrations.mjs --check  fail if they're out of date
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "services/api/migrations");
const target = join(root, "supabase/migrations");
const check = process.argv.includes("--check");

const expected = new Map();
for (const file of readdirSync(source).filter((f) => f.endsWith(".sql")).sort()) {
  const match = /^(\d{4})_(.+)\.sql$/.exec(file);
  if (!match) throw new Error(`unexpected migration name: ${file}`);
  // Keep in sync with supabaseVersion() in services/api/src/db/database.ts.
  const name = `2026090100${match[1]}_${match[2]}.sql`;
  const header = `-- Generated from services/api/migrations/${file} by scripts/supabase-migrations.mjs. Do not edit.\n\n`;
  expected.set(name, header + readFileSync(join(source, file), "utf8"));
}

const existing = (() => {
  try {
    return readdirSync(target).filter((f) => f.endsWith(".sql"));
  } catch {
    return [];
  }
})();

if (check) {
  const problems = [];
  for (const [name, content] of expected) {
    let actual = null;
    try {
      actual = readFileSync(join(target, name), "utf8");
    } catch {}
    if (actual !== content) problems.push(`${name} is ${actual === null ? "missing" : "out of date"}`);
  }
  for (const name of existing) if (!expected.has(name)) problems.push(`${name} has no source migration`);
  if (problems.length) {
    console.error(`supabase/migrations is out of date:\n  ${problems.join("\n  ")}\nRun: npm run supabase:migrations`);
    process.exit(1);
  }
  console.log(`supabase/migrations up to date (${expected.size} files)`);
} else {
  mkdirSync(target, { recursive: true });
  for (const name of existing) if (!expected.has(name)) rmSync(join(target, name));
  for (const [name, content] of expected) writeFileSync(join(target, name), content);
  console.log(`wrote ${expected.size} migrations to supabase/migrations`);
}
