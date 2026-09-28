import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { createApp } from "../src/bootstrap";
import { createDatabase, migrate } from "../src/db/database";
import { DemoAiProvider } from "../src/modules/ai/demo.provider";
import { LocalObjectStorage } from "../src/modules/documents/storage";
import { DEMO_ACCOUNT, seed } from "../src/demo";
import type { INestApplication } from "@nestjs/common";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let app: INestApplication;
let base: string;

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_BASE_URL: "http://127.0.0.1" } as NodeJS.ProcessEnv);
  const db = await createDatabase({});
  await migrate(db);
  const storage = new LocalObjectStorage(mkdtempSync(join(tmpdir(), "hm-demo-")), config.PUBLIC_BASE_URL, config.jwtSecret);
  app = await createApp({ config, database: db, aiProvider: new DemoAiProvider(), storage }, { logger: false });
  await app.listen(0);
  const address = app.getHttpServer().address() as { port: number };
  base = `http://127.0.0.1:${address.port}/v1`;
});
afterAll(async () => {
  await app.close();
});

async function login() {
  const res = await fetch(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: DEMO_ACCOUNT.email, password: DEMO_ACCOUNT.password }) });
  return { authorization: `Bearer ${((await res.json()) as { accessToken: string }).accessToken}` };
}

describe("demo mode", () => {
  it("reports itself as a demo so clients can label it", async () => {
    const meta = (await (await fetch(`${base}/meta`)).json()) as { ai: { available: boolean; demo: boolean } };
    expect(meta.ai).toEqual({ available: true, demo: true });
  });

  it("seeds a non-medical demo account, idempotently", async () => {
    await seed(base);
    await seed(base);
    const auth = await login();
    const profile = (await (await fetch(`${base}/me`, { headers: auth })).json()) as Record<string, unknown[]> & { profile: { firstName: string } };
    expect(profile.profile.firstName).toBe("Alex");
    expect(profile.conditions).toEqual([]);
    expect(profile.allergies).toEqual([]);
    expect(profile.medications).toEqual([]);
    const memories = (await (await fetch(`${base}/memories`, { headers: auth })).json()) as unknown[];
    expect(memories).toHaveLength(1);
    const plan = (await (await fetch(`${base}/plan`, { headers: auth })).json()) as { items: { source: string; kind: string }[] };
    expect(plan.items.map((i) => i.kind)).not.toContain("medication");
  });

  it("labels chat answers as a demo and still applies the safety pipeline", async () => {
    const auth = { ...(await login()), "content-type": "application/json" };
    const routine = (await (await fetch(`${base}/conversations`, { method: "POST", headers: auth, body: JSON.stringify({ message: "tips for sleeping better" }) })).json()) as {
      messages: { role: string; payload: { kind: string; answer?: string } }[];
    };
    const reply = routine.messages.find((m) => m.role === "assistant")!;
    expect(reply.payload.kind).toBe("answer");
    expect(reply.payload.answer).toMatch(/^Demo mode/);

    const emergency = (await (await fetch(`${base}/conversations`, { method: "POST", headers: auth, body: JSON.stringify({ message: "crushing chest pain and I can't breathe" }) })).json()) as {
      messages: { role: string; payload: { kind: string } }[];
    };
    expect(emergency.messages.find((m) => m.role === "assistant")!.payload.kind).toBe("escalation");
  });
});
