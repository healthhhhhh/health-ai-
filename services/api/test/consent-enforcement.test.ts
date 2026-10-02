import "reflect-metadata";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap";
import { RateLimiter } from "../src/common/rate-limit";
import { loadConfig } from "../src/config";
import { migrate, type Database } from "../src/db/database";
import { PERMISSION_WITHDRAWN_REASON } from "../src/modules/account/account.service";
import { ProcessingNotPermittedError } from "../src/modules/account/processing-policy";
import { AiGateway } from "../src/modules/ai/ai.gateway";
import { TASK_PURPOSE } from "../src/modules/ai/ai.tasks";
import { AI_TASKS, type AiProviderRequest, type AiProviderResponse } from "../src/modules/ai/ai.types";
import { FakeAiProvider } from "../src/modules/ai/fake.provider";
import { ChatAnswerSchema } from "../src/modules/chat/chat.prompts";
import { ChatService } from "../src/modules/chat/chat.service";
import { JobQueue, type JobHandler, type JobName, type JobPayloads } from "../src/modules/documents/job-queue";
import { LocalObjectStorage } from "../src/modules/documents/storage";
import { HealthDataService } from "../src/modules/health-data/health-data.service";
import { chatAnswer, testDatabase } from "./helpers";

/** Holds jobs until the test runs them, so "queued, not started" and "in flight" can be reproduced. */
class HeldJobQueue extends JobQueue {
  private readonly handlers = new Map<JobName, JobHandler<JobName>>();
  readonly held: { name: JobName; data: unknown }[] = [];
  register<N extends JobName>(name: N, handler: JobHandler<N>) {
    this.handlers.set(name, handler as JobHandler<JobName>);
  }
  async enqueue<N extends JobName>(name: N, data: JobPayloads[N]) {
    this.held.push({ name, data });
  }
  async drain() {
    while (this.held.length) {
      const job = this.held.shift()!;
      await this.handlers.get(job.name)!(job.data as never);
    }
  }
}

/** A metered fake ("anthropic" priced as Opus 5.5) whose calls can be paused mid-flight. Never touches the network. */
class GatedProvider extends FakeAiProvider {
  started = 0;
  private gate: Promise<void> | null = null;
  private open: (() => void) | null = null;
  constructor() {
    super({ name: "anthropic", model: "claude-opus-5-5", usage: { inputTokens: 1_000, outputTokens: 500 }, metered: true });
  }
  pause() {
    this.gate = new Promise((resolve) => (this.open = resolve));
  }
  resume() {
    this.open?.();
    this.gate = null;
  }
  override async generate(req: AiProviderRequest): Promise<AiProviderResponse> {
    this.started += 1;
    if (this.gate) await this.gate;
    return super.generate(req);
  }
}

const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF");
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const extraction = {
  readable: true,
  documentType: "lab_results",
  summary: "Synthetic test report: one value is outside the printed range.",
  findings: [{ name: "Test value", value: "1", unit: "u", referenceRange: "0-0.5", flag: "high", page: 1, explanation: "A synthetic value used in tests." }],
  suggestedQuestions: ["What does this value mean for me?"],
  containsInstructionsToAi: false,
};
const imageAnalysis = {
  quality: "good",
  qualityIssue: null,
  supported: true,
  bodyArea: "forearm",
  observations: ["A small red patch."],
  possibleCauses: [{ name: "Irritation", likelihood: "possible" }],
  recommendations: ["Keep the area clean."],
  warningSigns: ["Spreading redness"],
  careUrgency: "routine",
  containsInstructionsToAi: false,
};

let app: INestApplication;
let http: ReturnType<typeof request>;
let db: Database;
let ai: GatedProvider;
let jobs: HeldJobQueue;

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_BASE_URL: "http://127.0.0.1" } as NodeJS.ProcessEnv);
  db = await testDatabase();
  await migrate(db);
  ai = new GatedProvider();
  ai.on("report_analysis", () => extraction).on("image_analysis", () => imageAnalysis).on("chat", () => chatAnswer());
  jobs = new HeldJobQueue();
  const storage = new LocalObjectStorage(mkdtempSync(join(tmpdir(), "hm-consent-")), config.PUBLIC_BASE_URL, config.jwtSecret);
  app = await createApp({ config, database: db, aiProvider: ai, storage, jobQueue: jobs }, { logger: false });
  http = request(app.getHttpServer());
});
afterAll(async () => {
  await app?.close();
});
beforeEach(async () => {
  ai.requests.length = 0;
  ai.started = 0;
  ai.resume();
  await jobs.drain();
});

let counter = 0;
async function signUp(consents: string[] = ["ai_processing", "document_processing", "health_data_sync"]) {
  counter += 1;
  await app.get(RateLimiter).reset();
  const res = await http.post("/v1/auth/register").send({ email: `consent${counter}-${Date.now()}@example.com`, password: "correct horse battery", firstName: "Sam", timeZone: "UTC" }).expect(201);
  const auth = { Authorization: `Bearer ${res.body.accessToken as string}` };
  for (const kind of consents) await setConsent(auth, kind, true);
  return { userId: res.body.userId as string, auth };
}
const setConsent = (auth: Record<string, string>, kind: string, granted: boolean) => http.post("/v1/me/consents").set(auth).send({ kind, granted }).expect(204);

async function uploadAndQueue(auth: Record<string, string>, kind: "report" | "image") {
  const file = kind === "report" ? PDF : PNG;
  const contentType = kind === "report" ? "application/pdf" : "image/png";
  const created = await http.post("/v1/documents").set(auth).send({ kind, filename: kind === "report" ? "synthetic.pdf" : "synthetic.png", contentType, byteSize: file.length, purpose: kind === "image" ? "skin" : undefined }).expect(201);
  await http.put(new URL(created.body.upload.url).pathname).set("Content-Type", contentType).send(file).expect(200);
  const id = created.body.document.id as string;
  await http.post(`/v1/documents/${id}/process`).set(auth).send(kind === "image" ? { note: "Synthetic note" } : {}).expect(202);
  return id;
}

const usage = async (userId: string) => (await db.query<{ status: string; cost: number }>(`SELECT status, cost_usd::float8 AS cost FROM ai_usage WHERE user_id = $1`, [userId])).rows;
const reservations = async (userId: string) => (await db.query<{ status: string }>(`SELECT status FROM ai_budget_reservations WHERE user_id = $1`, [userId])).rows;
const spend = async (userId: string) => (await db.query<{ spent: number; reserved: number }>(`SELECT spent_usd::float8 AS spent, reserved_usd::float8 AS reserved FROM ai_budget_periods WHERE user_id = $1`, [userId])).rows[0] ?? { spent: 0, reserved: 0 };
const analyses = async (id: string) => Number((await db.query<{ n: number }>(`SELECT ((SELECT count(*) FROM document_analysis WHERE document_id = $1) + (SELECT count(*) FROM image_analysis WHERE image_id = $1))::int AS n`, [id])).rows[0]!.n);
const timelineEvents = async (userId: string) => Number((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM timeline_events WHERE user_id = $1 AND source_type = 'document'`, [userId])).rows[0]!.n);
const notifications = async (userId: string) => Number((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1`, [userId])).rows[0]!.n);
const until = async (condition: () => boolean) => {
  for (let i = 0; i < 200 && !condition(); i++) await new Promise((resolve) => setTimeout(resolve, 5));
  expect(condition()).toBe(true);
};

describe("purposes", () => {
  it("are derived from the task on the server, for every task", () => {
    for (const task of AI_TASKS) expect(TASK_PURPOSE[task]).toMatch(/^(ai_processing|document_processing)$/);
    expect(TASK_PURPOSE.report_analysis).toBe("document_processing");
    expect(TASK_PURPOSE.image_analysis).toBe("document_processing");
    expect(TASK_PURPOSE.health_chat).toBe("ai_processing");
  });
});

describe("queued report and photo analysis after a withdrawal", () => {
  it.each(["report", "image"] as const)("never reaches the provider, charges nothing and shows a clear stopped state (%s)", async (kind) => {
    const user = await signUp();
    const id = await uploadAndQueue(user.auth, kind);
    expect(jobs.held).toHaveLength(1); // queued, not started

    await setConsent(user.auth, "document_processing", false);
    await jobs.drain(); // the worker now executes the queued job

    expect(ai.started).toBe(0);
    expect(ai.requests).toHaveLength(0);
    expect(await usage(user.userId)).toEqual([]);
    expect(await reservations(user.userId)).toEqual([]);
    expect(await spend(user.userId)).toEqual({ spent: 0, reserved: 0 });
    const doc = await http.get(`/v1/documents/${id}`).set(user.auth).expect(200);
    expect(doc.body.status).toBe("failed");
    expect(doc.body.failureReason).toBe(PERMISSION_WITHDRAWN_REASON);
    expect(await analyses(id)).toBe(0);
    expect(await timelineEvents(user.userId)).toBe(0);
    expect(await notifications(user.userId)).toBe(0);
    if (kind === "image") {
      const { rows } = await db.query<{ note: string | null }>(`SELECT note FROM health_images WHERE id = $1`, [id]);
      expect(rows[0]!.note).toBeNull(); // kept only for the analysis
    }
  });

  it("is stopped by the worker's own check even when the queued row wasn't updated by the withdrawal", async () => {
    const user = await signUp();
    const id = await uploadAndQueue(user.auth, "report");
    // A withdrawal recorded without the usual cleanup (e.g. written by another path).
    await db.query(`INSERT INTO consents (user_id, kind, granted, version) VALUES ($1, 'document_processing', false, 'test')`, [user.userId]);
    await jobs.drain();
    expect(ai.started).toBe(0);
    expect(await reservations(user.userId)).toEqual([]);
    const doc = await http.get(`/v1/documents/${id}`).set(user.auth).expect(200);
    expect(doc.body.status).toBe("failed");
    expect(doc.body.failureReason).toBe(PERMISSION_WITHDRAWN_REASON);
  });

  it("is idempotent: repeating the withdrawal changes nothing further and doesn't fail", async () => {
    const user = await signUp();
    const id = await uploadAndQueue(user.auth, "report");
    await setConsent(user.auth, "document_processing", false);
    const first = (await db.query<{ processed_at: Date; failure_reason: string }>(`SELECT processed_at, failure_reason FROM medical_documents WHERE id = $1`, [id])).rows[0]!;
    await setConsent(user.auth, "document_processing", false);
    await setConsent(user.auth, "document_processing", false);
    await jobs.drain();
    const after = (await db.query<{ processed_at: Date; failure_reason: string; status: string }>(`SELECT processed_at, failure_reason, status FROM medical_documents WHERE id = $1`, [id])).rows[0]!;
    expect(after).toEqual({ ...first, status: "failed" });
    expect(ai.started).toBe(0);
    const consents = await http.get("/v1/me/consents").set(user.auth).expect(200);
    expect(consents.body.find((c: { kind: string }) => c.kind === "document_processing").granted).toBe(false);
    const audits = (await db.query<{ metadata: Record<string, unknown> }>(`SELECT metadata FROM audit_logs WHERE user_id = $1 AND action = 'consent.update' ORDER BY created_at`, [user.userId])).rows;
    expect(audits.filter((a) => a.metadata.stopped === 1)).toHaveLength(1); // only the first withdrawal stopped anything
  });

  it("can be analysed again after permission is granted again", async () => {
    const user = await signUp();
    const id = await uploadAndQueue(user.auth, "report");
    await setConsent(user.auth, "document_processing", false);
    await jobs.drain();
    await setConsent(user.auth, "document_processing", true);
    await http.post(`/v1/documents/${id}/process`).set(user.auth).send({}).expect(202);
    await jobs.drain();
    const doc = await http.get(`/v1/documents/${id}`).set(user.auth).expect(200);
    expect(doc.body.status).toBe("ready");
    expect(ai.requests).toHaveLength(1);
  });
});

describe("withdrawal racing with the worker", () => {
  it("discards the result of a call already in flight (it can't be recalled), while still accounting for its cost", async () => {
    const user = await signUp();
    const id = await uploadAndQueue(user.auth, "report");
    ai.pause();
    const worker = jobs.drain();
    await until(() => ai.started === 1); // handed to the provider
    await setConsent(user.auth, "document_processing", false);
    ai.resume();
    await worker;

    // The provider did receive the request — a withdrawal can't recall it.
    expect(ai.requests).toHaveLength(1);
    // Its cost is still settled honestly (nothing is left reserved).
    const rows = await usage(user.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.cost).toBeGreaterThan(0);
    expect((await spend(user.userId)).reserved).toBe(0);
    // …but nothing from it is kept or announced.
    const doc = await http.get(`/v1/documents/${id}`).set(user.auth).expect(200);
    expect(doc.body.status).toBe("failed");
    expect(doc.body.failureReason).toBe(PERMISSION_WITHDRAWN_REASON);
    expect(await analyses(id)).toBe(0);
    expect(await timelineEvents(user.userId)).toBe(0);
    expect(await notifications(user.userId)).toBe(0);
  });

  it("leaves a result that finished before the withdrawal in place", async () => {
    const user = await signUp();
    const id = await uploadAndQueue(user.auth, "image");
    await jobs.drain();
    await setConsent(user.auth, "document_processing", false);
    const doc = await http.get(`/v1/documents/${id}`).set(user.auth).expect(200);
    expect(doc.body.status).toBe("ready");
    expect(await analyses(id)).toBe(1);
  });

  it("ends in a consistent state when the save and the withdrawal run concurrently", async () => {
    for (let i = 0; i < 5; i++) {
      const user = await signUp();
      const id = await uploadAndQueue(user.auth, "report");
      ai.pause();
      const worker = jobs.drain();
      await until(() => ai.started === 1);
      ai.started = 0;
      ai.resume();
      await Promise.all([worker, setConsent(user.auth, "document_processing", false)]);
      const { rows } = await db.query<{ status: string }>(`SELECT status FROM medical_documents WHERE id = $1`, [id]);
      const stored = await analyses(id);
      // Either the save committed first (result kept, then permission withdrawn for the future),
      // or the withdrawal did (nothing stored). Never a half state.
      if (rows[0]!.status === "ready") expect(stored).toBe(1);
      else {
        expect(rows[0]!.status).toBe("failed");
        expect(stored).toBe(0);
      }
      expect((await spend(user.userId)).reserved).toBe(0);
    }
  });
});

describe("direct AI requests", () => {
  const chatRequest = (userId: string) => ({ task: "health_chat" as const, userId, system: ["rules"], messages: [{ role: "user" as const, content: "Synthetic question" }], schema: ChatAnswerSchema });

  it("are refused before any reservation or provider call when consent was withdrawn", async () => {
    const user = await signUp();
    await setConsent(user.auth, "ai_processing", false);
    await expect(app.get(AiGateway).generate(chatRequest(user.userId))).rejects.toBeInstanceOf(ProcessingNotPermittedError);
    expect(ai.started).toBe(0);
    expect(await usage(user.userId)).toEqual([]);
    expect(await reservations(user.userId)).toEqual([]);
  });

  it("are refused when consent was never given", async () => {
    const user = await signUp([]);
    await expect(app.get(AiGateway).generate(chatRequest(user.userId))).rejects.toBeInstanceOf(ProcessingNotPermittedError);
    expect(ai.started).toBe(0);
    expect(await reservations(user.userId)).toEqual([]);
  });

  it("still run unchanged while consent holds", async () => {
    const user = await signUp();
    const result = await app.get(AiGateway).generate(chatRequest(user.userId));
    expect(result.data.answer).toBeTruthy();
    expect(ai.requests).toHaveLength(1);
    expect((await reservations(user.userId)).map((r) => r.status)).toEqual(["settled"]);
  });
});

describe("chat safety when consent changes", () => {
  it("answers emergencies deterministically with no model call", async () => {
    const user = await signUp();
    const res = await http.post("/v1/conversations").set(user.auth).send({ message: "I have crushing chest pain and can't breathe" }).expect(201);
    expect(res.body.messages[1].payload.kind).toBe("escalation");
    expect(ai.started).toBe(0);
  });

  it("gives deterministic urgent guidance, not an AI call, if consent is withdrawn mid-request", async () => {
    const user = await signUp();
    await setConsent(user.auth, "ai_processing", false);
    // The controller check already passed for this request; the gateway is the last line.
    const result = await app.get(ChatService).start(user.userId, "I have a fever and a stiff neck");
    const assistant = result.messages[1]!;
    expect(assistant.payload?.kind).toBe("escalation");
    expect(ai.started).toBe(0);
    expect(await reservations(user.userId)).toEqual([]);
  });

  it("refuses a routine message with the usual consent error if consent is withdrawn mid-request", async () => {
    const user = await signUp();
    await setConsent(user.auth, "ai_processing", false);
    await expect(app.get(ChatService).start(user.userId, "How can I sleep better?")).rejects.toBeInstanceOf(ProcessingNotPermittedError);
    expect(ai.started).toBe(0);
    await http.post("/v1/conversations").set(user.auth).send({ message: "How can I sleep better?" }).expect(403);
  });

  it("works as before while consent holds", async () => {
    const user = await signUp();
    const res = await http.post("/v1/conversations").set(user.auth).send({ message: "How can I sleep better?" }).expect(201);
    expect(res.body.messages[1].payload.kind).toBe("answer");
    expect(ai.requests).toHaveLength(1);
  });
});

describe("memory embeddings", () => {
  const embedded = async (id: string) => (await db.query<{ e: boolean }>(`SELECT embedding IS NOT NULL AS e FROM health_memories WHERE id = $1`, [id])).rows[0]!.e;

  it("are computed only while AI processing is allowed, and caught up when it's granted again", async () => {
    const user = await signUp();
    await setConsent(user.auth, "ai_processing", false);
    const memory = (await http.post("/v1/memories").set(user.auth).send({ fact: "Synthetic fact: walks every morning" }).expect(201)).body;
    await jobs.drain();
    expect(await embedded(memory.id)).toBe(false);

    await setConsent(user.auth, "ai_processing", true);
    await jobs.drain();
    expect(await embedded(memory.id)).toBe(true);
  });

  it("are skipped for work queued before a withdrawal", async () => {
    const user = await signUp();
    const memory = (await http.post("/v1/memories").set(user.auth).send({ fact: "Synthetic fact: drinks tea" }).expect(201)).body;
    await setConsent(user.auth, "ai_processing", false);
    await jobs.drain();
    expect(await embedded(memory.id)).toBe(false);
  });

  it("work as before while consent holds", async () => {
    const user = await signUp();
    const memory = (await http.post("/v1/memories").set(user.auth).send({ fact: "Synthetic fact: cycles to work" }).expect(201)).body;
    await jobs.drain();
    expect(await embedded(memory.id)).toBe(true);
  });
});

describe("Apple Health sync", () => {
  const record = { day: "2026-09-30", kind: "steps" as const, value: 1234, isComplete: true, computedAt: "2026-10-01T06:00:00.000Z" };
  const stored = async (userId: string) => Number((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM daily_health_records WHERE user_id = $1`, [userId])).rows[0]!.n);

  it("refuses to store data at execution time once sync consent is withdrawn", async () => {
    const user = await signUp();
    await setConsent(user.auth, "health_data_sync", false);
    const service = app.get(HealthDataService);
    await expect(service.upsertDaily(user.userId, [record], { timeZone: "UTC" })).rejects.toBeInstanceOf(ProcessingNotPermittedError);
    await expect(service.ingest(user.userId, [{ kind: "steps", value: 10, recordedAt: "2026-09-30T08:00:00.000Z", source: "apple_health" }])).rejects.toBeInstanceOf(ProcessingNotPermittedError);
    expect(await stored(user.userId)).toBe(0);
    await http.put("/v1/health-data/daily").set(user.auth).send({ records: [record], timeZone: "UTC" }).expect(403);
  });

  it("still accepts readings people enter themselves without sync consent", async () => {
    const user = await signUp([]);
    const result = await app.get(HealthDataService).ingest(user.userId, [{ kind: "weight", value: 70, recordedAt: "2026-09-30T08:00:00.000Z", source: "user_entered" }]);
    expect(result.inserted).toBe(1);
  });

  it("works as before while consent holds", async () => {
    const user = await signUp();
    await http.put("/v1/health-data/daily").set(user.auth).send({ records: [record], timeZone: "UTC" }).expect(200);
    expect(await stored(user.userId)).toBe(1);
  });
});
