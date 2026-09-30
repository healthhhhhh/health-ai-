import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { AppModule } from "../src/app.module";
import { AuthGuard } from "../src/common/auth";
import { RateLimitGuard } from "../src/common/rate-limit";
import { AccountService } from "../src/modules/account/account.service";
import { createTestContext, signUp, type TestContext } from "./helpers";

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});

const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF");

describe("symptoms", () => {
  it("tracks symptoms and their occurrences, newest first", async () => {
    const user = await signUp(ctx);
    const { id } = (await ctx.http.post("/v1/symptoms").set(user.auth).send({ name: "Headache", bodyArea: "head" }).expect(201)).body;
    // Same name (any case) reuses the symptom.
    expect((await ctx.http.post("/v1/symptoms").set(user.auth).send({ name: "headache" }).expect(201)).body.id).toBe(id);
    const logged = await ctx.http.post(`/v1/symptoms/${id}/events`).set(user.auth).send({ severity: 4, notes: "Dull, after screens" }).expect(201);
    expect(logged.body).toMatchObject({ triageLevel: "routine", escalation: null });
    const list = (await ctx.http.get("/v1/symptoms").set(user.auth).expect(200)).body;
    expect(list).toEqual([expect.objectContaining({ id, name: "Headache", status: "active", lastSeverity: 4 })]);
    expect((await ctx.http.get(`/v1/symptoms/${id}/events`).set(user.auth).expect(200)).body).toHaveLength(1);
    expect((await ctx.http.get("/v1/timeline").set(user.auth).expect(200)).body.events[0]).toMatchObject({ eventType: "symptom", sourceType: "user_entered" });
    await ctx.http.patch(`/v1/symptoms/${id}`).set(user.auth).send({ status: "resolved" }).expect(204);
    expect((await ctx.http.get("/v1/symptoms?status=active").set(user.auth).expect(200)).body).toEqual([]);
  });

  it("returns fixed emergency guidance for red-flag symptoms without any AI call", async () => {
    const user = await signUp(ctx);
    const calls = ctx.ai.requests.length;
    const { id } = (await ctx.http.post("/v1/symptoms").set(user.auth).send({ name: "Chest pain" }).expect(201)).body;
    const res = await ctx.http.post(`/v1/symptoms/${id}/events`).set(user.auth).send({ severity: 8, notes: "chest pain spreading to my left arm, sweating" }).expect(201);
    expect(res.body.triageLevel).toBe("emergency");
    expect(res.body.escalation).toMatchObject({ level: "emergency", actions: expect.arrayContaining([expect.objectContaining({ kind: "call_emergency" })]) });
    expect(ctx.ai.requests.length).toBe(calls);
  });

  it("validates input and keeps symptoms private", async () => {
    const owner = await signUp(ctx);
    const other = await signUp(ctx);
    await ctx.http.post("/v1/symptoms").set(owner.auth).send({ name: "" }).expect(400);
    const { id } = (await ctx.http.post("/v1/symptoms").set(owner.auth).send({ name: "Rash" }).expect(201)).body;
    await ctx.http.post(`/v1/symptoms/${id}/events`).set(owner.auth).send({ severity: 11 }).expect(400);
    await ctx.http.post(`/v1/symptoms/${id}/events`).set(other.auth).send({ severity: 2 }).expect(404);
    await ctx.http.get(`/v1/symptoms/${id}/events`).set(other.auth).expect(200, []);
    await ctx.http.delete(`/v1/symptoms/${id}`).set(other.auth).expect(404);
    expect((await ctx.http.get("/v1/symptoms").set(other.auth).expect(200)).body).toEqual([]);
    await ctx.http.get("/v1/symptoms").expect(401);
  });
});

describe("care", () => {
  it("keeps providers and appointments, soft-deleting them", async () => {
    const user = await signUp(ctx);
    const provider = (await ctx.http.post("/v1/care/providers").set(user.auth).send({ name: "Dr. Example", specialty: "GP", website: "https://clinic.example" }).expect(201)).body;
    await ctx.http.post("/v1/care/providers").set(user.auth).send({ name: "X", website: "javascript:alert(1)" }).expect(400);
    const startsAt = new Date(Date.now() + 86_400_000).toISOString();
    const appt = (await ctx.http.post("/v1/care/appointments").set(user.auth).send({ title: "Check-up", careProviderId: provider.id, startsAt, mode: "in_person" }).expect(201)).body;
    await ctx.http.post("/v1/care/appointments").set(user.auth).send({ title: "Bad", startsAt, endsAt: startsAt }).expect(400);
    expect((await ctx.http.get("/v1/care/appointments").set(user.auth).expect(200)).body).toEqual([
      expect.objectContaining({ id: appt.id, providerName: "Dr. Example", status: "scheduled" }),
    ]);
    await ctx.http.patch(`/v1/care/appointments/${appt.id}`).set(user.auth).send({ status: "cancelled" }).expect(204);
    await ctx.http.delete(`/v1/care/appointments/${appt.id}`).set(user.auth).expect(204);
    await ctx.http.delete(`/v1/care/appointments/${appt.id}`).set(user.auth).expect(404);
    expect((await ctx.http.get("/v1/care/appointments?when=all").set(user.auth).expect(200)).body).toEqual([]);
    const { rows } = await ctx.db.query(`SELECT deleted_at FROM appointments WHERE id = $1`, [appt.id]);
    expect(rows[0]).toBeDefined();
    await ctx.http.delete(`/v1/care/providers/${provider.id}`).set(user.auth).expect(204);
    expect((await ctx.http.get("/v1/care/providers").set(user.auth).expect(200)).body).toEqual([]);
  });

  it("won't link an appointment to someone else's provider", async () => {
    const owner = await signUp(ctx);
    const other = await signUp(ctx);
    const provider = (await ctx.http.post("/v1/care/providers").set(owner.auth).send({ name: "Dr. Owner" }).expect(201)).body;
    await ctx.http
      .post("/v1/care/appointments")
      .set(other.auth)
      .send({ title: "Sneaky", careProviderId: provider.id, startsAt: new Date().toISOString() })
      .expect(404);
    await ctx.http.delete(`/v1/care/providers/${provider.id}`).set(other.auth).expect(404);
    expect((await ctx.http.get("/v1/care/providers").set(other.auth).expect(200)).body).toEqual([]);
  });
});

describe("HealthKit connection", () => {
  it("records connection, sync and disconnect", async () => {
    const user = await signUp(ctx);
    expect((await ctx.http.get("/v1/healthkit/connection").set(user.auth).expect(200)).body.status).toBe("never_connected");
    await ctx.http.put("/v1/healthkit/connection").set(user.auth).send({ deviceName: "iPhone", scopes: ["steps", "heart_rate"] }).expect(200);
    await ctx.http
      .put("/v1/health-data/daily")
      .set(user.auth)
      .send({ timeZone: "UTC", records: [{ day: new Date().toISOString().slice(0, 10), kind: "steps", value: 5000, isComplete: false, computedAt: new Date().toISOString() }] })
      .expect(200);
    const connected = (await ctx.http.get("/v1/healthkit/connection").set(user.auth).expect(200)).body;
    expect(connected).toMatchObject({ status: "connected", deviceName: "iPhone", scopes: ["steps", "heart_rate"] });
    expect(connected.lastSyncAt).not.toBeNull();
    expect((await ctx.http.delete("/v1/healthkit/connection").set(user.auth).expect(200)).body.removed).toBe(1);
    expect((await ctx.http.get("/v1/healthkit/connection").set(user.auth).expect(200)).body.status).toBe("disconnected");
  });

  it("needs the health-data consent", async () => {
    const user = await signUp(ctx, ["ai_processing"]);
    await ctx.http.put("/v1/healthkit/connection").set(user.auth).send({ scopes: ["steps"] }).expect(403);
  });
});

describe("document files", () => {
  it("gives the owner a short-lived download link and nobody else", async () => {
    const owner = await signUp(ctx);
    const other = await signUp(ctx);
    const created = await ctx.http.post("/v1/documents").set(owner.auth).send({ kind: "report", filename: "labs.pdf", contentType: "application/pdf", byteSize: PDF.length }).expect(201);
    const id = created.body.document.id as string;
    await ctx.http.get(`/v1/documents/${id}/file`).set(owner.auth).expect(409); // not uploaded yet
    await ctx.http.put(new URL(created.body.upload.url).pathname).set("Content-Type", "application/pdf").send(PDF).expect(200);
    await ctx.http.post(`/v1/documents/${id}/process`).set(owner.auth).send({}).expect(202);
    await ctx.drainJobs();
    await ctx.http.get(`/v1/documents/${id}/file`).set(other.auth).expect(404);
    const link = (await ctx.http.get(`/v1/documents/${id}/file`).set(owner.auth).expect(200)).body;
    expect(link.expiresIn).toBe(300);
    const path = new URL(link.url).pathname;
    const file = await ctx.http.get(path).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(file.headers["content-type"]).toBe("application/pdf");
    expect(Buffer.compare(file.body as Buffer, PDF)).toBe(0);
    // An upload token can't be used to download, and a tampered link fails.
    await ctx.http.get(new URL(created.body.upload.url).pathname).expect(403);
    await ctx.http.get(`${path}x`).expect(403);
  });
});

describe("account deletion", () => {
  it("removes stored files and every row, and finishes interrupted deletions", async () => {
    const user = await signUp(ctx);
    const created = await ctx.http.post("/v1/documents").set(user.auth).send({ kind: "report", filename: "labs.pdf", contentType: "application/pdf", byteSize: PDF.length }).expect(201);
    await ctx.http.put(new URL(created.body.upload.url).pathname).set("Content-Type", "application/pdf").send(PDF).expect(200);
    expect((await ctx.storage.list("medical-reports")).some((k) => k.startsWith(user.userId))).toBe(true);
    await ctx.http.post("/v1/symptoms").set(user.auth).send({ name: "Cough" }).expect(201);

    await ctx.http.post("/v1/me/delete").set(user.auth).send({ password: "correct horse battery" }).expect(204);
    expect((await ctx.storage.list("medical-reports")).some((k) => k.startsWith(user.userId))).toBe(false);
    for (const table of ["users", "symptoms", "medical_documents", "consents"]) {
      const column = table === "users" ? "id" : "user_id";
      expect((await ctx.db.query(`SELECT 1 FROM ${table} WHERE ${column} = $1`, [user.userId])).rows).toHaveLength(0);
    }
    // The old token no longer works.
    await ctx.http.get("/v1/me").set(user.auth).expect(401);

    // A deletion interrupted after it was requested is completed by the sweeper.
    const second = await signUp(ctx);
    await ctx.db.query(`UPDATE users SET deletion_requested_at = now() - interval '1 hour' WHERE id = $1`, [second.userId]);
    expect(await ctx.app.get(AccountService).finishPendingDeletions()).toBe(1);
    expect((await ctx.db.query(`SELECT 1 FROM users WHERE id = $1`, [second.userId])).rows).toHaveLength(0);
    expect(await ctx.app.get(AccountService).finishPendingDeletions()).toBe(0);
  });

  it("exports the new record types", async () => {
    const user = await signUp(ctx);
    const { id } = (await ctx.http.post("/v1/symptoms").set(user.auth).send({ name: "Fatigue" }).expect(201)).body;
    await ctx.http.post(`/v1/symptoms/${id}/events`).set(user.auth).send({ severity: 3 }).expect(201);
    await ctx.http.post("/v1/care/providers").set(user.auth).send({ name: "Dr. Example" }).expect(201);
    const exported = (await ctx.http.get("/v1/me/export").set(user.auth).expect(200)).body;
    expect(exported.symptoms[0]).toMatchObject({ name: "Fatigue", events: [expect.objectContaining({ severity: 3 })] });
    expect(exported.careProviders).toHaveLength(1);
    expect(exported).toHaveProperty("healthKit");
    expect(exported).toHaveProperty("appointments");
  });
});

describe("every endpoint", () => {
  it("is authenticated (except auth, uploads and liveness) and rate-limited", () => {
    const module = AppModule.register({} as never);
    const open = new Set(["HealthController", "AuthController", "UploadsController"]);
    for (const controller of module.controllers ?? []) {
      const guards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, controller) ?? [];
      if (controller.name === "HealthController") continue;
      expect(guards, `${controller.name} rate limit`).toContain(RateLimitGuard);
      if (!open.has(controller.name)) expect(guards, `${controller.name} auth`).toContain(AuthGuard);
    }
  });

  it("returns 429 with Retry-After once a limit is exceeded", async () => {
    const user = await signUp(ctx);
    let last = 0;
    for (let i = 0; i < 6; i++) last = (await ctx.http.get("/v1/me/export").set(user.auth)).status;
    expect(last).toBe(429);
    const res = await ctx.http.get("/v1/me/export").set(user.auth).expect(429);
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
  });
});
