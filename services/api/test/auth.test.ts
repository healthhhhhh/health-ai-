import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, signUp, type TestContext } from "./helpers";

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});

describe("auth", () => {
  it("registers, logs in and reads the profile", async () => {
    const user = await signUp(ctx);
    const me = await ctx.http.get("/v1/me").set(user.auth).expect(200);
    expect(me.body.profile.firstName).toBe("Alex");

    const login = await ctx.http.post("/v1/auth/login").send({ email: user.email.toUpperCase(), password: "correct horse battery" }).expect(200);
    expect(login.body.accessToken).toBeTruthy();
  });

  it("rejects wrong passwords with a generic message", async () => {
    const user = await signUp(ctx);
    const res = await ctx.http.post("/v1/auth/login").send({ email: user.email, password: "wrong password!" }).expect(401);
    expect(res.body.error.message).toBe("Email or password is incorrect.");
    await ctx.http.post("/v1/auth/login").send({ email: "nobody@example.com", password: "whatever123" }).expect(401);
  });

  it("refuses duplicate accounts", async () => {
    const user = await signUp(ctx);
    const res = await ctx.http.post("/v1/auth/register").send({ email: user.email, password: "another password", firstName: "A" }).expect(409);
    expect(res.body.error.code).toBe("conflict");
  });

  it("validates input without echoing values", async () => {
    const res = await ctx.http.post("/v1/auth/register").send({ email: "not-an-email", password: "short", firstName: "" }).expect(400);
    expect(res.body.error.code).toBe("validation_failed");
    expect(res.body.error.message).not.toContain("not-an-email");
  });

  it("rotates refresh tokens and revokes the family on reuse", async () => {
    const user = await signUp(ctx);
    const first = await ctx.http.post("/v1/auth/refresh").send({ refreshToken: user.refreshToken }).expect(200);
    const second = await ctx.http.post("/v1/auth/refresh").send({ refreshToken: first.body.refreshToken }).expect(200);
    // Reusing the original (already rotated) token is treated as theft...
    await ctx.http.post("/v1/auth/refresh").send({ refreshToken: user.refreshToken }).expect(401);
    // ...and revokes the newest token in the family too.
    await ctx.http.post("/v1/auth/refresh").send({ refreshToken: second.body.refreshToken }).expect(401);
  });

  it("logout revokes the session's refresh token", async () => {
    const user = await signUp(ctx);
    await ctx.http.post("/v1/auth/logout").send({ refreshToken: user.refreshToken }).expect(204);
    await ctx.http.post("/v1/auth/refresh").send({ refreshToken: user.refreshToken }).expect(401);
  });

  it("requires a valid token on health routes", async () => {
    await ctx.http.get("/v1/me").expect(401);
    await ctx.http.get("/v1/me").set({ Authorization: "Bearer not-a-token" }).expect(401);
  });
});

describe("profile and data controls", () => {
  it("stores medication instructions verbatim and never mixes users", async () => {
    const a = await signUp(ctx);
    const b = await signUp(ctx);
    const instruction = "  1 tablet at night — Dr. Lee said don't skip ";
    const med = await ctx.http.post("/v1/me/medications").set(a.auth).send({ name: "Night tablet", instruction, source: "clinician_provided" }).expect(201);
    const profileA = await ctx.http.get("/v1/me").set(a.auth).expect(200);
    expect(profileA.body.medications[0].instruction).toBe(instruction);
    const profileB = await ctx.http.get("/v1/me").set(b.auth).expect(200);
    expect(profileB.body.medications).toHaveLength(0);
    // B can't touch A's record.
    await ctx.http.delete(`/v1/me/medications/${med.body.id}`).set(b.auth).expect(404);
  });

  it("exports everything and deletes the account with the password", async () => {
    const user = await signUp(ctx);
    await ctx.http.post("/v1/me/conditions").set(user.auth).send({ name: "Asthma" }).expect(201);
    const exported = await ctx.http.get("/v1/me/export").set(user.auth).expect(200);
    expect(exported.body.conditions[0].name).toBe("Asthma");
    expect(exported.body.format).toBe("healthmate-export-v1");

    await ctx.http.post("/v1/me/delete").set(user.auth).send({ password: "wrong" }).expect(403);
    await ctx.http.post("/v1/me/delete").set(user.auth).send({ password: "correct horse battery" }).expect(204);
    await ctx.http.post("/v1/auth/login").send({ email: user.email, password: "correct horse battery" }).expect(401);
    const leftovers = await ctx.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM health_conditions WHERE user_id = $1`, [user.userId]);
    expect(leftovers.rows[0]!.n).toBe(0);
  });

  it("records consent history and reports the latest choice", async () => {
    const user = await signUp(ctx, []);
    await ctx.http.post("/v1/me/consents").set(user.auth).send({ kind: "voice", granted: true }).expect(204);
    await ctx.http.post("/v1/me/consents").set(user.auth).send({ kind: "voice", granted: false }).expect(204);
    const res = await ctx.http.get("/v1/me/consents").set(user.auth).expect(200);
    expect(res.body).toEqual([expect.objectContaining({ kind: "voice", granted: false })]);
  });
});
