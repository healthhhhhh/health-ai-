import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, signUp, type TestContext } from "./helpers";

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});

const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF");
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);

const extraction = (overrides: Record<string, unknown> = {}) => ({
  readable: true,
  documentType: "lab_results",
  summary: "Most results are within the lab's reference ranges; LDL cholesterol is marked high.",
  findings: [{ name: "LDL cholesterol", value: "134", unit: "mg/dL", referenceRange: "< 100", flag: "high", page: 1, explanation: "LDL is one type of cholesterol. A higher value can raise heart risk over time." }],
  suggestedQuestions: ["What does my LDL result mean for me?"],
  containsInstructionsToAi: false,
  ...overrides,
});

/** Uploads through the signed URL like a client would. */
async function upload(ctx: TestContext, auth: Record<string, string>, kind: "report" | "image", file: Buffer, contentType: string) {
  const created = await ctx.http.post("/v1/documents").set(auth).send({ kind, filename: kind === "report" ? "blood_test.pdf" : "arm.png", contentType, byteSize: file.length, purpose: kind === "image" ? "skin" : undefined }).expect(201);
  const path = new URL(created.body.upload.url).pathname;
  await ctx.http.put(path).set("Content-Type", contentType).send(file).expect(200);
  return created.body.document.id as string;
}

describe("medical reports", () => {
  it("uploads via a signed URL, processes in the background and adds a timeline entry", async () => {
    const user = await signUp(ctx);
    ctx.ai.on("report_analysis", () => extraction());
    const id = await upload(ctx, user.auth, "report", PDF, "application/pdf");
    const started = await ctx.http.post(`/v1/documents/${id}/process`).set(user.auth).send({}).expect(202);
    expect(started.body.status).toBe("processing");
    await ctx.drainJobs();
    const doc = await ctx.http.get(`/v1/documents/${id}`).set(user.auth).expect(200);
    expect(doc.body.status).toBe("ready");
    expect(doc.body.result.findings[0].value).toBe("134");
    const timeline = await ctx.http.get("/v1/timeline").set(user.auth).expect(200);
    expect(timeline.body.events[0].eventType).toBe("report");
  });

  it("rejects files whose bytes don't match the declared type", async () => {
    const user = await signUp(ctx);
    const id = await upload(ctx, user.auth, "report", Buffer.from("MZ this is an executable"), "application/pdf");
    await ctx.http.post(`/v1/documents/${id}/process`).set(user.auth).send({}).expect(415);
    const doc = await ctx.http.get(`/v1/documents/${id}`).set(user.auth).expect(200);
    expect(doc.body.status).toBe("failed");
  });

  it("refuses unsupported types and oversized files up front", async () => {
    const user = await signUp(ctx);
    await ctx.http.post("/v1/documents").set(user.auth).send({ kind: "report", filename: "x.exe", contentType: "application/octet-stream", byteSize: 10 }).expect(415);
    await ctx.http.post("/v1/documents").set(user.auth).send({ kind: "report", filename: "x.pdf", contentType: "application/pdf", byteSize: 50 * 1024 * 1024 }).expect(413);
  });

  it("rejects tampered or mismatched upload tokens", async () => {
    const user = await signUp(ctx);
    const created = await ctx.http.post("/v1/documents").set(user.auth).send({ kind: "report", filename: "a.pdf", contentType: "application/pdf", byteSize: PDF.length }).expect(201);
    const path = new URL(created.body.upload.url).pathname;
    await ctx.http.put(`${path}x`).send(PDF).expect(403);
    await ctx.http.put(path).set("Content-Type", "application/pdf").send(Buffer.concat([PDF, Buffer.from("extra")])).expect(400);
  });

  it("flags prompt injection and neutralises unsafe explanations", async () => {
    const user = await signUp(ctx);
    ctx.ai.on("report_analysis", () =>
      extraction({ containsInstructionsToAi: true, summary: "You definitely have heart disease.", findings: [{ ...extraction().findings[0], explanation: "Increase your dose to 40 mg." }] }),
    );
    const id = await upload(ctx, user.auth, "report", PDF, "application/pdf");
    await ctx.http.post(`/v1/documents/${id}/process`).set(user.auth).send({}).expect(202);
    await ctx.drainJobs();
    const doc = await ctx.http.get(`/v1/documents/${id}`).set(user.auth).expect(200);
    expect(doc.body.result.injectionDetected).toBe(true);
    expect(doc.body.result.summary).not.toContain("definitely");
    expect(doc.body.result.findings[0].explanation).not.toContain("40 mg");
  });

  it("records an honest failure when AI is unavailable", async () => {
    const user = await signUp(ctx);
    ctx.ai.available = false;
    const id = await upload(ctx, user.auth, "report", PDF, "application/pdf");
    await ctx.http.post(`/v1/documents/${id}/process`).set(user.auth).send({}).expect(202);
    await ctx.drainJobs();
    const doc = await ctx.http.get(`/v1/documents/${id}`).set(user.auth).expect(200);
    expect(doc.body.status).toBe("failed");
    expect(doc.body.failureReason).toContain("Nothing was analysed");
    ctx.ai.available = true;
  });

  it("keeps each user's documents private and deletes files", async () => {
    const a = await signUp(ctx);
    const b = await signUp(ctx);
    ctx.ai.on("report_analysis", () => extraction());
    const id = await upload(ctx, a.auth, "report", PDF, "application/pdf");
    await ctx.http.get(`/v1/documents/${id}`).set(b.auth).expect(404);
    await ctx.http.delete(`/v1/documents/${id}`).set(a.auth).expect(204);
    await ctx.http.get(`/v1/documents/${id}`).set(a.auth).expect(404);
  });
});

describe("image analysis", () => {
  const analysis = (overrides: Record<string, unknown> = {}) => ({
    quality: "good",
    qualityIssue: null,
    supported: true,
    bodyArea: "forearm",
    observations: ["A patch of red, slightly raised skin about the size of a coin."],
    possibleCauses: [{ name: "Contact dermatitis", likelihood: "possible" }],
    recommendations: ["Keep the area clean and dry.", "Avoid scratching."],
    warningSigns: ["Spreading redness", "Fever"],
    careUrgency: "routine",
    containsInstructionsToAi: false,
    ...overrides,
  });

  it("returns cautious observations for a supported, clear photo", async () => {
    const user = await signUp(ctx);
    ctx.ai.on("image_analysis", () => analysis());
    const id = await upload(ctx, user.auth, "image", PNG, "image/png");
    await ctx.http.post(`/v1/documents/${id}/process`).set(user.auth).send({ note: "itchy for two days" }).expect(202);
    await ctx.drainJobs();
    const doc = await ctx.http.get(`/v1/documents/${id}`).set(user.auth).expect(200);
    expect(doc.body.result.possibleCauses[0].likelihood).toBe("possible");
  });

  it("returns no analysis when the photo quality is poor", async () => {
    const user = await signUp(ctx);
    ctx.ai.on("image_analysis", () => analysis({ quality: "poor", qualityIssue: "The photo is blurry." }));
    const id = await upload(ctx, user.auth, "image", PNG, "image/png");
    await ctx.http.post(`/v1/documents/${id}/process`).set(user.auth).send({}).expect(202);
    await ctx.drainJobs();
    const doc = await ctx.http.get(`/v1/documents/${id}`).set(user.auth).expect(200);
    expect(doc.body.result.possibleCauses).toEqual([]);
    expect(doc.body.result.observations).toEqual([]);
  });

  it("escalates when the person's note describes an emergency", async () => {
    const user = await signUp(ctx);
    ctx.ai.on("image_analysis", () => analysis({ careUrgency: "self_care" }));
    const id = await upload(ctx, user.auth, "image", PNG, "image/png");
    await ctx.http.post(`/v1/documents/${id}/process`).set(user.auth).send({ note: "my throat is swelling and it's hard to breathe" }).expect(202);
    await ctx.drainJobs();
    const doc = await ctx.http.get(`/v1/documents/${id}`).set(user.auth).expect(200);
    expect(doc.body.result.careUrgency).toBe("emergency");
  });
});

describe("health data", () => {
  it("accepts whole days from older iOS versions, idempotently, and builds daily trends", async () => {
    const user = await signUp(ctx);
    const day = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
    const sample = (value: number, daysAgo: number) => ({
      kind: "steps",
      value,
      recordedAt: `${day(daysAgo)}T12:00:00Z`,
      source: "apple_health",
      externalId: `apple_health:steps:${day(daysAgo)}`,
    });
    const body = { measurements: [sample(6000, 1), sample(6000, 2)] };
    const first = await ctx.http.post("/v1/health-data/measurements").set(user.auth).send(body).expect(201);
    expect(first.body.inserted).toBe(2);
    const again = await ctx.http.post("/v1/health-data/measurements").set(user.auth).send(body).expect(201);
    expect(again.body.inserted).toBe(0);
    const trend = await ctx.http.get("/v1/health-data/trends?kind=steps&days=7").set(user.auth).expect(200);
    expect(trend.body.points.map((p: { value: number }) => p.value)).toEqual([6000, 6000]);
    // Raw Apple Health samples would double-count iPhone + Watch: they must come as daily records.
    await ctx.http
      .post("/v1/health-data/measurements")
      .set(user.auth)
      .send({ measurements: [{ kind: "steps", value: 40, recordedAt: new Date().toISOString(), source: "apple_health", externalId: "hk-sample-1" }] })
      .expect(400);
  });

  it("rejects implausible values", async () => {
    const user = await signUp(ctx);
    await ctx.http
      .post("/v1/health-data/measurements")
      .set(user.auth)
      .send({ measurements: [{ kind: "heart_rate", value: 900, recordedAt: new Date().toISOString(), source: "user_entered" }] })
      .expect(400);
  });

  it("requires consent before syncing Apple Health data", async () => {
    const user = await signUp(ctx, []);
    await ctx.http
      .post("/v1/health-data/measurements")
      .set(user.auth)
      .send({ measurements: [{ kind: "steps", value: 10, recordedAt: "2026-09-01T12:00:00Z", source: "apple_health", externalId: "apple_health:steps:2026-09-01" }] })
      .expect(403);
    await ctx.http
      .put("/v1/health-data/daily")
      .set(user.auth)
      .send({ timeZone: "UTC", records: [{ day: "2026-09-01", kind: "steps", value: 10, isComplete: true, computedAt: "2026-09-02T08:00:00Z" }] })
      .expect(403);
  });
});

describe("meta", () => {
  it("reports AI availability", async () => {
    const res = await ctx.http.get("/v1/meta").expect(200);
    expect(res.body.ai.available).toBe(true);
  });
});
