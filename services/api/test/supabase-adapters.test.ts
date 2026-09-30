import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet } from "jose";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { createDatabase, migrate } from "../src/db/database";
import { SupabaseIdentityProvider } from "../src/modules/auth/identity";
import { SupabaseObjectStorage } from "../src/modules/documents/storage";
import { SupabaseEmbeddingProvider } from "../src/modules/memory/embeddings";

const URL_ = "https://project.supabase.co";
const PUBLISHABLE = "sb_publishable_test";
const SECRET = "sb_secret_test";

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
function mockFetch(respond: (call: Call) => { status?: number; body?: unknown }) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL, init: RequestInit = {}) => {
    const call = { url: String(input), method: init.method ?? "GET", headers: (init.headers ?? {}) as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    const { status = 200, body = {} } = respond(call);
    return new Response(body instanceof Uint8Array ? body : JSON.stringify(body), { status });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe("configuration", () => {
  it("keeps Supabase secrets server-side and refuses unsafe production setups", () => {
    expect(() => loadConfig({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ NODE_ENV: "production", DATABASE_URL: "postgres://x" } as NodeJS.ProcessEnv)).toThrow(/Supabase Storage/);
    expect(() => loadConfig({ SUPABASE_URL: URL_ } as NodeJS.ProcessEnv)).toThrow(/SUPABASE_PUBLISHABLE_KEY/);
    const config = loadConfig({ SUPABASE_URL: URL_, SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE, SUPABASE_SECRET_KEY: SECRET } as NodeJS.ProcessEnv);
    expect(config).toMatchObject({ authProvider: "supabase", storageProvider: "supabase" });
    const production = loadConfig({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://x",
      SUPABASE_URL: URL_,
      SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
      SUPABASE_SECRET_KEY: SECRET,
    } as NodeJS.ProcessEnv);
    expect(production.embeddingsProvider).toBe("none");
    expect(production.migrateOnStart).toBe(false);
  });
});

describe("Supabase Auth adapter", () => {
  async function setup(respond: (call: Call) => { status?: number; body?: unknown }) {
    const db = await createDatabase({});
    await migrate(db);
    const { publicKey, privateKey } = await generateKeyPair("ES256");
    const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "ES256" };
    const { fetchImpl, calls } = mockFetch(respond);
    const provider = new SupabaseIdentityProvider(URL_, PUBLISHABLE, SECRET, db, { fetchImpl, jwks: createLocalJWKSet({ keys: [jwk] }) });
    const sign = (claims: Record<string, unknown>, options: { issuer?: string; audience?: string; expires?: string } = {}) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: "ES256", kid: "k1" })
        .setIssuer(options.issuer ?? `${URL_}/auth/v1`)
        .setAudience(options.audience ?? "authenticated")
        .setIssuedAt()
        .setExpirationTime(options.expires ?? "1h")
        .sign(privateKey);
    return { db, provider, calls, sign };
  }
  const session = { access_token: "at", refresh_token: "rt", expires_in: 3600, user: { id: "11111111-1111-4111-8111-111111111111" } };

  it("verifies Supabase access tokens (signature, issuer, audience, role, expiry)", async () => {
    const { provider, sign } = await setup(() => ({}));
    const sub = "22222222-2222-4222-8222-222222222222";
    expect(await provider.verifyAccessToken(await sign({ sub, role: "authenticated" }))).toBe(sub);
    expect(await provider.verifyAccessToken(await sign({ sub, role: "anon" }))).toBeNull();
    expect(await provider.verifyAccessToken(await sign({ sub, role: "authenticated" }, { issuer: "https://evil.example/auth/v1" }))).toBeNull();
    expect(await provider.verifyAccessToken(await sign({ sub, role: "authenticated" }, { audience: "other" }))).toBeNull();
    expect(await provider.verifyAccessToken(await sign({ sub, role: "authenticated" }, { expires: "-1m" }))).toBeNull();
    // A token signed with another key is rejected.
    const other = await generateKeyPair("ES256");
    const forged = await new SignJWT({ sub, role: "authenticated" }).setProtectedHeader({ alg: "ES256", kid: "k1" }).setIssuer(`${URL_}/auth/v1`).setAudience("authenticated").setExpirationTime("1h").sign(other.privateKey);
    expect(await provider.verifyAccessToken(forged)).toBeNull();
    expect(await provider.verifyAccessToken("not-a-jwt")).toBeNull();
  });

  it("maps sign-up, sign-in, refresh and reset onto Supabase Auth with the publishable key only", async () => {
    const { provider, calls } = await setup((call) => {
      if (call.url.endsWith("/signup")) return { body: session };
      if (call.url.includes("grant_type=password")) return (call.body as { password: string }).password === "right password" ? { body: session } : { status: 400, body: { error_code: "invalid_credentials" } };
      if (call.url.includes("grant_type=refresh_token")) return (call.body as { refresh_token: string }).refresh_token === "rt" ? { body: { ...session, refresh_token: "rt2" } } : { status: 400 };
      return { body: {} };
    });
    const registered = await provider.register({ email: " Alex@Example.com ", password: "right password", firstName: "Alex", lastName: "", timeZone: "UTC" });
    expect(registered).toMatchObject({ userId: session.user.id, tokens: { accessToken: "at", refreshToken: "rt", expiresIn: 3600 } });
    expect(calls[0]!.body).toMatchObject({ email: "alex@example.com", data: { first_name: "Alex", time_zone: "UTC" } });
    await expect(provider.login("alex@example.com", "wrong")).rejects.toMatchObject({ status: 401 });
    expect((await provider.refresh("rt")).refreshToken).toBe("rt2");
    await expect(provider.refresh("stolen")).rejects.toMatchObject({ status: 401 });
    await provider.requestPasswordReset("alex@example.com", "https://app.example/reset");
    expect(calls.at(-1)!.url).toBe(`${URL_}/auth/v1/recover?redirect_to=${encodeURIComponent("https://app.example/reset")}`);
    // Public auth calls never carry the secret key.
    for (const call of calls) expect(JSON.stringify(call.headers)).not.toContain(SECRET);
  });

  it("reports email confirmation and existing accounts clearly", async () => {
    const { provider } = await setup((call) =>
      (call.body as { email: string }).email === "taken@example.com" ? { status: 422, body: { error_code: "user_already_exists" } } : { body: { id: "33333333-3333-4333-8333-333333333333" } },
    );
    expect(await provider.register({ email: "new@example.com", password: "p", firstName: "N", lastName: "", timeZone: "UTC" })).toEqual({
      userId: "33333333-3333-4333-8333-333333333333",
      confirmationRequired: true,
    });
    await expect(provider.register({ email: "taken@example.com", password: "p", firstName: "N", lastName: "", timeZone: "UTC" })).rejects.toMatchObject({ status: 409 });
  });

  it("deletes the identity with the secret key, idempotently, and removes HealthMate rows", async () => {
    const id = "44444444-4444-4444-8444-444444444444";
    let deleted = false;
    const { provider, calls, db } = await setup((call) => {
      if (call.method === "DELETE") {
        const status = deleted ? 404 : 200;
        deleted = true;
        return { status };
      }
      return {};
    });
    await db.query(`INSERT INTO auth.users (id, email) VALUES ($1, 'gone@example.com')`, [id]);
    await provider.deleteIdentity(id);
    await provider.deleteIdentity(id); // second time: Supabase says 404, still fine
    const admin = calls.filter((c) => c.method === "DELETE");
    expect(admin[0]!.url).toBe(`${URL_}/auth/v1/admin/users/${id}`);
    expect(admin[0]!.headers.apikey).toBe(SECRET);
    expect(admin[0]!.headers.Authorization).toBeUndefined(); // new-style secret keys go in apikey only
    expect((await db.query(`SELECT 1 FROM users WHERE id = $1`, [id])).rows).toHaveLength(0);
  });

  it("completes a password reset with the recovery session, then signs out everywhere", async () => {
    const { provider, calls, sign } = await setup((call) => (call.method === "PUT" && (call.body as { password: string }).password === "same" ? { status: 422, body: { error_code: "same_password" } } : {}));
    const recovery = await sign({ sub: "55555555-5555-4555-8555-555555555555", role: "authenticated", amr: [{ method: "recovery" }] });
    await provider.completePasswordReset(recovery, "a brand new passphrase");
    expect(calls.map((c) => `${c.method} ${c.url.replace(URL_, "")}`)).toEqual(["PUT /auth/v1/user", "POST /auth/v1/logout?scope=global"]);
    expect(calls[0]!.headers.Authorization).toBe(`Bearer ${recovery}`);
    await expect(provider.completePasswordReset("forged.token.value", "whatever passphrase")).rejects.toMatchObject({ status: 401 });
    await expect(provider.completePasswordReset(recovery, "same")).rejects.toMatchObject({ status: 400 });
  });

  it("changes the password with the person's own session after checking the current one, and signs out other sessions", async () => {
    const id = "66666666-6666-4666-8666-666666666666";
    const { provider, calls, db } = await setup((call) => {
      if (call.url.includes("grant_type=password")) return (call.body as { password: string }).password === "current passphrase" ? { body: { ...session, access_token: "check-at" } } : { status: 400, body: { error_code: "invalid_credentials" } };
      if (call.method === "PUT") return (call.body as { password: string }).password === "same" ? { status: 422, body: { error_code: "same_password" } } : { body: {} };
      return { body: {} };
    });
    await db.query(`INSERT INTO auth.users (id, email) VALUES ($1, 'pw@example.com')`, [id]);
    await expect(provider.changePassword(id, "wrong", "a new passphrase", "person-at")).rejects.toMatchObject({ status: 403 });
    calls.length = 0;
    await provider.changePassword(id, "current passphrase", "a new passphrase", "person-at");
    const steps = calls.map((c) => `${c.method} ${c.url.replace(URL_, "")} ${c.headers.Authorization ?? ""}`.trim());
    expect(steps).toEqual([
      "POST /auth/v1/token?grant_type=password", // check the current password…
      "POST /auth/v1/logout?scope=local Bearer check-at", // …without leaving that check's session behind
      "PUT /auth/v1/user Bearer person-at", // change it with the person's own session
      "POST /auth/v1/logout?scope=others Bearer person-at", // and end every other session
    ]);
    await expect(provider.changePassword(id, "current passphrase", "same", "person-at")).rejects.toMatchObject({ status: 400 });
    await expect(provider.changePassword(id, "current passphrase", "a new passphrase")).rejects.toMatchObject({ status: 401 });
  });

  it("confirms an email with the link's token hash and resends without revealing accounts", async () => {
    const { provider, calls } = await setup((call) => {
      if (call.url.endsWith("/verify")) return (call.body as { token_hash: string }).token_hash === "good-hash" ? { body: session } : { status: 403, body: { error_code: "otp_expired" } };
      if (call.url.endsWith("/resend")) return (call.body as { email: string }).email === "nobody@example.com" ? { status: 400 } : { body: {} };
      return { body: {} };
    });
    expect(await provider.verifyEmail("good-hash")).toMatchObject({ userId: session.user.id, tokens: { accessToken: "at" } });
    expect(calls[0]!.body).toEqual({ type: "email", token_hash: "good-hash" });
    await expect(provider.verifyEmail("expired-hash")).rejects.toMatchObject({ status: 400, code: "invalid_token" });
    await provider.resendVerification(" Someone@Example.com ");
    expect(calls.at(-1)!.body).toEqual({ type: "signup", email: "someone@example.com" });
    await expect(provider.resendVerification("nobody@example.com")).resolves.toBeUndefined();
  });

  it("reports an unconfirmed email with its own error code", async () => {
    const { provider } = await setup(() => ({ status: 400, body: { error_code: "email_not_confirmed" } }));
    await expect(provider.login("new@example.com", "p")).rejects.toMatchObject({ status: 401, code: "email_not_confirmed" });
  });

  it("fails closed with a friendly error when Supabase Auth is down", async () => {
    const { provider } = await setup(() => ({ status: 503 }));
    await expect(provider.login("a@example.com", "p")).rejects.toMatchObject({ status: 503 });
  });
});

describe("Supabase Storage adapter", () => {
  it("issues signed URLs for private objects and deletes a user's folder", async () => {
    const listed: Record<string, { name: string }[]> = { "medical-reports": [{ name: "doc-1" }, { name: "doc-2" }], "health-images": [{ name: "img-1" }], avatars: [] };
    const { fetchImpl, calls } = mockFetch((call) => {
      if (call.url.includes("/object/upload/sign/")) return { body: { url: "/object/upload/sign/medical-reports/u/doc-1?token=abc" } };
      if (call.url.includes("/object/sign/")) return { body: { signedURL: "/object/sign/medical-reports/u/doc-1?token=def" } };
      if (call.url.includes("/object/list/")) {
        const bucket = call.url.split("/object/list/")[1]!;
        const items = listed[bucket] ?? [];
        listed[bucket] = [];
        return { body: items };
      }
      return { body: [] };
    });
    const storage = new SupabaseObjectStorage(URL_, SECRET, fetchImpl);
    const upload = await storage.createUploadUrl({ bucket: "medical-reports", path: "u/doc-1" }, "application/pdf", 100, 600);
    expect(upload.url).toBe(`${URL_}/storage/v1/object/upload/sign/medical-reports/u/doc-1?token=abc`);
    const download = await storage.createDownloadUrl({ bucket: "medical-reports", path: "u/doc-1" }, 300);
    expect(download).toContain("/storage/v1/object/sign/medical-reports/u/doc-1?token=def");
    expect(calls[1]!.body).toEqual({ expiresIn: 300 });
    await storage.deleteUserFiles("u");
    const deletes = calls.filter((c) => c.method === "DELETE");
    expect(deletes.map((d) => [d.url.split("/object/")[1], d.body])).toEqual([
      ["medical-reports", { prefixes: ["u/doc-1", "u/doc-2"] }],
      ["health-images", { prefixes: ["u/img-1"] }],
    ]);
    // Every call is server-side with the secret key; list calls are scoped to the user's folder.
    for (const call of calls) expect(call.headers.apikey).toBe(SECRET);
    for (const call of calls.filter((c) => c.url.includes("/object/list/"))) expect(call.body).toMatchObject({ prefix: "u/" });
  });

  it("encodes paths and fails loudly on storage errors", async () => {
    const { fetchImpl, calls } = mockFetch(() => ({ status: 500 }));
    const storage = new SupabaseObjectStorage(URL_, SECRET, fetchImpl);
    await expect(storage.createDownloadUrl({ bucket: "health-images", path: "u/a b" }, 60)).rejects.toThrow(/500/);
    expect(calls[0]!.url).toContain("/object/sign/health-images/u/a%20b");
  });
});

describe("Supabase embeddings adapter", () => {
  it("calls the embed Edge Function with the shared secret and validates dimensions", async () => {
    const { fetchImpl, calls } = mockFetch((call) => ({ body: { embeddings: (call.body as { input: string[] }).input.map(() => new Array(384).fill(0.1)) } }));
    const provider = new SupabaseEmbeddingProvider(URL_, SECRET, "function-secret-0123456789abcdef", fetchImpl);
    expect((await provider.embed(["a", "b"])).length).toBe(2);
    expect(calls[0]!.url).toBe(`${URL_}/functions/v1/embed`);
    expect(calls[0]!.headers["x-healthmate-secret"]).toBe("function-secret-0123456789abcdef");
    const bad = new SupabaseEmbeddingProvider(URL_, SECRET, "function-secret-0123456789abcdef", mockFetch(() => ({ body: { embeddings: [[1, 2, 3]] } })).fetchImpl);
    await expect(bad.embed(["a"])).rejects.toThrow(/unexpected/);
  });
});
