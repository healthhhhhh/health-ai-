import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RateLimiter } from "../src/common/rate-limit";
import { loadConfig } from "../src/config";
import { referenceDay } from "../src/modules/account/age";
import { GoogleIdTokenVerifier, idTokenVerifiersFor } from "../src/modules/auth/oauth";
import { createTestContext, signUp, type TestContext } from "./helpers";

/**
 * Google sign-in with synthetic tokens signed by a test key (no Google account,
 * network or paid service involved). The verifier is the real one; only its
 * key set is local.
 */
const CLIENT_ID = "1234567890-ios.apps.googleusercontent.com";
const WEB_CLIENT_ID = "1234567890-web.apps.googleusercontent.com";

let privateKey: CryptoKey;
let otherKey: CryptoKey;
let verifier: GoogleIdTokenVerifier;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  otherKey = (await generateKeyPair("RS256")).privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: "google-test", alg: "RS256", use: "sig" };
  verifier = new GoogleIdTokenVerifier([CLIENT_ID, WEB_CLIENT_ID], { keys: createLocalJWKSet({ keys: [jwk] }) });
});

let counter = 0;
function googleToken(overrides: { claims?: Record<string, unknown>; issuer?: string; audience?: string; expires?: string | number; key?: CryptoKey; subject?: string } = {}) {
  counter += 1;
  const claims = { email: `person${counter}-${Date.now()}@gmail.com`, email_verified: true, given_name: "Sam", family_name: "Rivera", ...overrides.claims };
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "google-test" })
    .setIssuer(overrides.issuer ?? "https://accounts.google.com")
    .setAudience(overrides.audience ?? CLIENT_ID)
    .setSubject(overrides.subject ?? `10${counter}${Date.now()}`)
    .setIssuedAt()
    .setExpirationTime(overrides.expires ?? "1h")
    .sign(overrides.key ?? privateKey);
}

describe("Google ID-token verification", () => {
  it("accepts a valid token for one of our client IDs", async () => {
    const identity = await verifier.verify(await googleToken({ subject: "sub-1", claims: { email: "Sam@Gmail.com" } }));
    expect(identity).toEqual({ provider: "google", subject: "sub-1", email: "sam@gmail.com", emailVerified: true, givenName: "Sam", familyName: "Rivera" });
    // Web client ID and the short issuer form are accepted too.
    await expect(verifier.verify(await googleToken({ audience: WEB_CLIENT_ID, issuer: "accounts.google.com" }))).resolves.toMatchObject({ provider: "google" });
  });

  it("rejects invalid, expired and mismatched tokens", async () => {
    const rejects = async (token: string | Promise<string>, nonce?: string) => expect(verifier.verify(await token, nonce)).rejects.toMatchObject({ code: "invalid_token" });
    await rejects(googleToken({ key: otherKey })); // signature from another key
    await rejects(googleToken({ expires: "-5m" })); // expired (beyond the 30 s tolerance)
    await rejects(googleToken({ audience: "someone-elses-app.apps.googleusercontent.com" })); // mismatched audience
    await rejects(googleToken({ issuer: "https://accounts.example.com" })); // mismatched issuer
    await rejects(googleToken({ claims: { nonce: "expected-nonce-1" } }), "different-nonce"); // mismatched nonce
    await rejects(googleToken(), "nonce-the-token-lacks"); // nonce requested but absent
    await rejects("not.a.jwt");
    await rejects("");
    // An unsigned token ("alg": "none") never passes.
    const header = Buffer.from(JSON.stringify({ alg: "none", kid: "google-test" })).toString("base64url");
    const body = Buffer.from(JSON.stringify({ iss: "https://accounts.google.com", aud: CLIENT_ID, sub: "x", iat: 1, exp: 9_999_999_999 })).toString("base64url");
    await rejects(`${header}.${body}.`);
  });

  it("checks the nonce when the app sent one", async () => {
    await expect(verifier.verify(await googleToken({ claims: { nonce: "n-0123456789" } }), "n-0123456789")).resolves.toMatchObject({ provider: "google" });
  });

  it("reports unverified email addresses", async () => {
    expect((await verifier.verify(await googleToken({ claims: { email_verified: false } }))).emailVerified).toBe(false);
  });

  it("is only enabled when client IDs are configured", () => {
    expect(idTokenVerifiersFor(loadConfig({ NODE_ENV: "test" } as NodeJS.ProcessEnv))).toEqual({});
    const config = loadConfig({ NODE_ENV: "test", GOOGLE_CLIENT_IDS: ` ${CLIENT_ID} , ${WEB_CLIENT_ID},` } as unknown as NodeJS.ProcessEnv);
    expect(config.googleClientIds).toEqual([CLIENT_ID, WEB_CLIENT_ID]);
    expect(Object.keys(idTokenVerifiersFor(config))).toEqual(["google"]);
  });
});

describe("Continue with Google", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext({ idTokenVerifiers: { google: verifier } });
  });
  afterAll(() => ctx.close());

  beforeEach(() => ctx.app.get(RateLimiter).reset());
  const oauth = (body: Record<string, unknown>) => ctx.http.post("/v1/auth/oauth").send({ provider: "google", timeZone: "Europe/London", ...body });
  const users = async (email: string) => Number((await ctx.db.query<{ n: string }>(`SELECT count(*) AS n FROM users WHERE email = $1`, [email])).rows[0]!.n);

  it("creates an account on first use and signs the same person in afterwards", async () => {
    const subject = `sub-new-${Date.now()}`;
    const email = `new-${Date.now()}@gmail.com`;
    const first = await oauth({ idToken: await googleToken({ subject, claims: { email } }) }).expect(200);
    expect(first.body).toMatchObject({ isNewUser: true, userId: expect.any(String), accessToken: expect.any(String), refreshToken: expect.any(String) });
    const auth = { Authorization: `Bearer ${first.body.accessToken}` };

    const account = (await ctx.http.get("/v1/me/account").set(auth).expect(200)).body;
    expect(account).toMatchObject({ email, emailVerified: true, signInMethods: ["google"] });
    const profile = (await ctx.http.get("/v1/me").set(auth).expect(200)).body;
    expect(profile.profile).toMatchObject({ firstName: "Sam", lastName: "Rivera", timeZone: "Europe/London" });

    const again = await oauth({ idToken: await googleToken({ subject, claims: { email } }) }).expect(200);
    expect(again.body).toMatchObject({ isNewUser: false, userId: first.body.userId });
    expect(await users(email)).toBe(1);

    // No password was ever set, so password sign-in fails like a wrong password.
    await ctx.http.post("/v1/auth/login").send({ email, password: "any password at all" }).expect(401);
    // The export lists the linked sign-in (never the token).
    const exported = (await ctx.http.get("/v1/me/export").set(auth).expect(200)).body;
    expect(exported.signInIdentities).toEqual([expect.objectContaining({ provider: "google", email })]);
  });

  it("refuses invalid, expired and mismatched tokens without creating anything", async () => {
    const email = `refused-${Date.now()}@gmail.com`;
    for (const token of [
      await googleToken({ claims: { email }, key: otherKey }),
      await googleToken({ claims: { email }, expires: "-5m" }),
      await googleToken({ claims: { email }, audience: "another-app.apps.googleusercontent.com" }),
      "garbage-token-value-that-is-long-enough",
    ]) {
      const res = await oauth({ idToken: token }).expect(401);
      expect(res.body.error.code).toBe("invalid_token");
    }
    await oauth({ idToken: await googleToken({ claims: { email, nonce: "nonce-aaaaaaaa" } }), nonce: "nonce-bbbbbbbb" }).expect(401);
    expect(await users(email)).toBe(0);
  });

  it("never takes over an existing password account with the same email", async () => {
    const owner = await signUp(ctx, []);
    const res = await oauth({ idToken: await googleToken({ claims: { email: owner.email } }) }).expect(409);
    expect(res.body.error.code).toBe("conflict");
    expect((await ctx.db.query(`SELECT 1 FROM auth_identities WHERE user_id = $1`, [owner.userId])).rows).toHaveLength(0);
  });

  it("needs a verified email to create an account", async () => {
    const email = `unverified-${Date.now()}@gmail.com`;
    await oauth({ idToken: await googleToken({ claims: { email, email_verified: false } }) }).expect(400);
    expect(await users(email)).toBe(0);
  });

  it("answers 501 when the app sends no token, and for Apple", async () => {
    expect((await oauth({}).expect(501)).body.error.code).toBe("not_available");
    await oauth({ provider: "apple", idToken: await googleToken() }).expect(501);
  });

  it("links Google to a signed-in account, and keeps at least one way to sign in", async () => {
    const owner = await signUp(ctx, []);
    const subject = `sub-link-${Date.now()}`;
    const token = await googleToken({ subject, claims: { email: `other-address-${Date.now()}@gmail.com` } });
    await ctx.http.post("/v1/me/identities").set(owner.auth).send({ provider: "google", idToken: token }).expect(204);
    await ctx.http.post("/v1/me/identities").set(owner.auth).send({ provider: "google", idToken: token }).expect(204); // idempotent
    expect((await ctx.http.get("/v1/me/account").set(owner.auth).expect(200)).body.signInMethods).toEqual(["password", "google"]);

    // Signing in with that Google account now opens the same account.
    const signedIn = await oauth({ idToken: await googleToken({ subject }) }).expect(200);
    expect(signedIn.body).toMatchObject({ userId: owner.userId, isNewUser: false });

    // Someone else can't claim the same Google account.
    const other = await signUp(ctx, []);
    await ctx.http.post("/v1/me/identities").set(other.auth).send({ provider: "google", idToken: await googleToken({ subject }) }).expect(409);
    // Nor can the owner link a second Google account.
    await ctx.http.post("/v1/me/identities").set(owner.auth).send({ provider: "google", idToken: await googleToken() }).expect(409);
    // Invalid tokens are refused here too.
    await ctx.http.post("/v1/me/identities").set(owner.auth).send({ provider: "google", idToken: await googleToken({ key: otherKey }) }).expect(401);

    await ctx.http.delete("/v1/me/identities/google").set(owner.auth).expect(204);
    expect((await ctx.http.get("/v1/me/account").set(owner.auth).expect(200)).body.signInMethods).toEqual(["password"]);

    // A Google-only account can't remove its only sign-in method.
    const googleOnly = await oauth({ idToken: await googleToken() }).expect(200);
    await ctx.http.delete("/v1/me/identities/google").set({ Authorization: `Bearer ${googleOnly.body.accessToken}` }).expect(409);
    await ctx.http.delete("/v1/me/identities/facebook").set(owner.auth).expect(400);
  });

  it("lets a Google-only account confirm deletion with a fresh Google sign-in", async () => {
    const subject = `sub-delete-${Date.now()}`;
    const created = await oauth({ idToken: await googleToken({ subject }) }).expect(200);
    const auth = { Authorization: `Bearer ${created.body.accessToken}` };
    // Someone else's Google account doesn't count as confirmation.
    await ctx.http.post("/v1/me/delete").set(auth).send({ provider: "google", idToken: await googleToken() }).expect(403);
    await ctx.http.post("/v1/me/delete").set(auth).send({ provider: "google", idToken: await googleToken({ subject, key: otherKey }) }).expect(401);
    await ctx.http.post("/v1/me/delete").set(auth).send({ provider: "google", idToken: await googleToken({ subject }) }).expect(204);
    expect((await ctx.db.query(`SELECT 1 FROM auth_identities WHERE user_id = $1`, [created.body.userId])).rows).toHaveLength(0);
    expect((await ctx.db.query(`SELECT 1 FROM users WHERE id = $1`, [created.body.userId])).rows).toHaveLength(0);
  });
  it("records an optional age screen only after the Google token is verified, and works without one", async () => {
    const birth = (years: number) => {
      const [y, m, d] = referenceDay().split("-").map(Number) as [number, number, number];
      return new Date(Date.UTC(y - years, m - 1, d)).toISOString().slice(0, 10);
    };
    const age = async (userId: string) => (await ctx.db.query<{ age_band: string; n: number }>(`SELECT age_band, (SELECT count(*)::int FROM age_assessments WHERE user_id = $1) AS n FROM users WHERE id = $1`, [userId])).rows[0]!;
    const withScreen = await oauth({ idToken: await googleToken(), ageScreen: { dateOfBirth: birth(25) } }).expect(200);
    expect(await age(withScreen.body.userId)).toEqual({ age_band: "adult", n: 1 });
    const without = await oauth({ idToken: await googleToken() }).expect(200);
    expect(await age(without.body.userId)).toEqual({ age_band: "unknown", n: 0 });
    // An invalid screen is refused before anything is created; a rejected token records nothing.
    const email = `screen-refused-${Date.now()}@gmail.com`;
    await oauth({ idToken: await googleToken({ claims: { email } }), ageScreen: { dateOfBirth: "2026-02-30" } }).expect(400);
    await oauth({ idToken: await googleToken({ claims: { email }, key: otherKey }), ageScreen: { dateOfBirth: birth(25) } }).expect(401);
    expect(await users(email)).toBe(0);
  });
});

describe("Continue with Google when not configured", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(() => ctx.close());

  it("answers 501 even with a token", async () => {
    await ctx.app.get(RateLimiter).reset();
    const res = await ctx.http.post("/v1/auth/oauth").send({ provider: "google", idToken: await googleToken() }).expect(501);
    expect(res.body.error.message).toContain("isn't available on this server yet");
  });
});
