import { createHash } from "node:crypto";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RateLimiter } from "../src/common/rate-limit";
import { loadConfig } from "../src/config";
import { AppleIdTokenVerifier, GoogleIdTokenVerifier, idTokenVerifiersFor } from "../src/modules/auth/oauth";
import { createTestContext, type TestContext } from "./helpers";

/**
 * Sign in with Apple with synthetic tokens signed by a test key (no Apple account,
 * network or paid program involved). The verifier is the real one; only its key
 * set is local. Shapes follow Apple's ID tokens: issuer https://appleid.apple.com,
 * audience = bundle ID, `nonce` = SHA-256 (hex) of the app's raw nonce, no name.
 */
const BUNDLE_ID = "com.healthmate.app";
const SERVICES_ID = "com.healthmate.web";
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

let privateKey: CryptoKey;
let otherKey: CryptoKey;
let verifier: AppleIdTokenVerifier;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  otherKey = (await generateKeyPair("RS256")).privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: "apple-test", alg: "RS256", use: "sig" };
  verifier = new AppleIdTokenVerifier([BUNDLE_ID, SERVICES_ID], { keys: createLocalJWKSet({ keys: [jwk] }) });
});

let counter = 0;
function appleToken(overrides: { claims?: Record<string, unknown>; issuer?: string; audience?: string; expires?: string | number; key?: CryptoKey; subject?: string } = {}) {
  counter += 1;
  const claims = { email: `relay${counter}-${Date.now()}@privaterelay.appleid.com`, email_verified: "true", is_private_email: "true", ...overrides.claims };
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "apple-test" })
    .setIssuer(overrides.issuer ?? "https://appleid.apple.com")
    .setAudience(overrides.audience ?? BUNDLE_ID)
    .setSubject(overrides.subject ?? `000${counter}.${Date.now()}.0001`)
    .setIssuedAt()
    .setExpirationTime(overrides.expires ?? "10m")
    .sign(overrides.key ?? privateKey);
}

describe("Apple ID-token verification", () => {
  it("accepts a valid token for our bundle ID or Services ID", async () => {
    const identity = await verifier.verify(await appleToken({ subject: "001.abc.002", claims: { email: "Sam@PrivateRelay.AppleID.com" } }));
    expect(identity).toEqual({ provider: "apple", subject: "001.abc.002", email: "sam@privaterelay.appleid.com", emailVerified: true, givenName: null, familyName: null });
    await expect(verifier.verify(await appleToken({ audience: SERVICES_ID }))).resolves.toMatchObject({ provider: "apple" });
  });

  it("rejects invalid, expired and mismatched tokens", async () => {
    const rejects = async (token: string | Promise<string>, nonce?: string) => expect(verifier.verify(await token, nonce)).rejects.toMatchObject({ code: "invalid_token" });
    await rejects(appleToken({ key: otherKey }));
    await rejects(appleToken({ expires: "-5m" }));
    await rejects(appleToken({ audience: "com.someone.else" }));
    await rejects(appleToken({ issuer: "https://accounts.google.com" })); // a Google token isn't an Apple one
    await rejects("not.a.jwt");
    const header = Buffer.from(JSON.stringify({ alg: "none", kid: "apple-test" })).toString("base64url");
    const body = Buffer.from(JSON.stringify({ iss: "https://appleid.apple.com", aud: BUNDLE_ID, sub: "x", iat: 1, exp: 9_999_999_999 })).toString("base64url");
    await rejects(`${header}.${body}.`);
  });

  it("compares the hash of the app's raw nonce", async () => {
    const raw = "raw-nonce-0123456789";
    await expect(verifier.verify(await appleToken({ claims: { nonce: sha256(raw) } }), raw)).resolves.toMatchObject({ provider: "apple" });
    // The raw value in the token, a different nonce, or a missing one are all refused.
    await expect(verifier.verify(await appleToken({ claims: { nonce: raw } }), raw)).rejects.toMatchObject({ code: "invalid_token" });
    await expect(verifier.verify(await appleToken({ claims: { nonce: sha256("other-nonce-000") } }), raw)).rejects.toMatchObject({ code: "invalid_token" });
    await expect(verifier.verify(await appleToken(), raw)).rejects.toMatchObject({ code: "invalid_token" });
  });

  it("is only enabled when client IDs are configured, independently of Google", () => {
    expect(idTokenVerifiersFor(loadConfig({ NODE_ENV: "test" } as NodeJS.ProcessEnv))).toEqual({});
    const apple = loadConfig({ NODE_ENV: "test", APPLE_CLIENT_IDS: ` ${BUNDLE_ID} , ${SERVICES_ID},` } as unknown as NodeJS.ProcessEnv);
    expect(apple.appleClientIds).toEqual([BUNDLE_ID, SERVICES_ID]);
    expect(Object.keys(idTokenVerifiersFor(apple))).toEqual(["apple"]);
    const both = idTokenVerifiersFor(loadConfig({ NODE_ENV: "test", APPLE_CLIENT_IDS: BUNDLE_ID, GOOGLE_CLIENT_IDS: "1-ios.apps.googleusercontent.com" } as unknown as NodeJS.ProcessEnv));
    expect(both.apple).toBeInstanceOf(AppleIdTokenVerifier);
    expect(both.google).toBeInstanceOf(GoogleIdTokenVerifier);
  });
});

describe("Continue with Apple", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext({ env: { AGE_ENFORCEMENT: "enforce" }, idTokenVerifiers: { apple: verifier } });
  });
  afterAll(() => ctx.close());
  beforeEach(() => ctx.app.get(RateLimiter).reset());

  const oauth = (body: Record<string, unknown>) => ctx.http.post("/v1/auth/oauth").send({ provider: "apple", timeZone: "America/Chicago", ...body });

  it("creates an account with the name the app sends, then goes through age setup like any account", async () => {
    const subject = `001.new.${Date.now()}`;
    const raw = "raw-nonce-abcdefghij";
    const first = await oauth({ idToken: await appleToken({ subject, claims: { nonce: sha256(raw) } }), nonce: raw, firstName: "Robin", lastName: "Lee" }).expect(200);
    expect(first.body).toMatchObject({ isNewUser: true, userId: expect.any(String) });
    const auth = { Authorization: `Bearer ${first.body.accessToken}` };

    const account = (await ctx.http.get("/v1/me/account").set(auth).expect(200)).body;
    expect(account).toMatchObject({ signInMethods: ["apple"], firstName: "Robin", onboardingCompleted: false, ageStatus: "unknown", ageEligibility: "age_required" });
    // Health features stay locked until the date of birth is given (same gate as email accounts).
    expect((await ctx.http.get("/v1/me").set(auth).expect(403)).body.error.code).toBe("age_required");

    const again = await oauth({ idToken: await appleToken({ subject }) }).expect(200);
    expect(again.body).toMatchObject({ isNewUser: false, userId: first.body.userId });
  });

  it("refuses bad tokens and never asks Google's verifier", async () => {
    await oauth({ idToken: await appleToken({ key: otherKey }) }).expect(401);
    const google = await ctx.http.post("/v1/auth/oauth").send({ provider: "google", timeZone: "UTC", idToken: await appleToken() }).expect(501);
    expect(google.body.error.code).toBe("not_available");
  });

  it("an Apple-only account can delete itself with a fresh Apple token or by typing DELETE", async () => {
    const subject = `001.del.${Date.now()}`;
    const res = await oauth({ idToken: await appleToken({ subject }) }).expect(200);
    const auth = { Authorization: `Bearer ${res.body.accessToken}` };
    // Someone else's Apple token can't delete it.
    await ctx.http.post("/v1/me/delete").set(auth).send({ provider: "apple", idToken: await appleToken({ subject: "001.someone.else" }) }).expect(403);
    await ctx.http.post("/v1/me/delete").set(auth).send({ provider: "apple", idToken: await appleToken({ subject }) }).expect(204);

    const other = await oauth({ idToken: await appleToken() }).expect(200);
    await ctx.http.post("/v1/me/delete").set({ Authorization: `Bearer ${other.body.accessToken}` }).send({ confirm: "DELETE" }).expect(204);
  });
});
