import { buildSampleAccount, SAMPLE_EMAIL, type SampleAccount } from "@healthmate/sample-data";
import type { OAuthProvider } from "@healthmate/shared-types";

/**
 * In-memory Preview-mode accounts, one per browser session (Phase 1 only).
 * Lives in the Next.js server process; restarting it re-seeds the sample data.
 */
export interface PreviewSession {
  id: string;
  account: SampleAccount;
  /** Documents being "analysed": id → time the sample result becomes ready. */
  processing: Map<string, number>;
}

interface PendingSignup {
  email: string;
  firstName: string;
  lastName: string;
  timeZone: string;
  token: string;
}

/** An email HealthMate "sent" in Preview mode (shown in the Preview inbox). */
export interface PreviewEmail {
  id: string;
  to: string;
  subject: string;
  body: string;
  /** In-app link, e.g. "/verify-email/confirm?token=…". */
  link: string;
  linkLabel: string;
  sentAt: string;
}

interface PreviewStore {
  sessions: Map<string, PreviewSession>;
  pending: Map<string, PendingSignup>;
  resets: Map<string, string>;
  inbox: PreviewEmail[];
}

const globalStore = globalThis as typeof globalThis & { __healthmatePreview?: PreviewStore };
const store: PreviewStore = (globalStore.__healthmatePreview ??= { sessions: new Map(), pending: new Map(), resets: new Map(), inbox: [] });

const randomId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 20);

/** Session ids embed the time zone so a session can be rebuilt after a server restart. */
function encodeSessionId(timeZone: string) {
  return `${randomId()}~${Buffer.from(timeZone).toString("base64url")}`;
}

function timeZoneOf(sessionId: string) {
  const encoded = sessionId.split("~")[1];
  try {
    const zone = encoded ? Buffer.from(encoded, "base64url").toString() : "";
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return zone || "Europe/London";
  } catch {
    return "Europe/London";
  }
}

export function validTimeZone(zone: unknown): string {
  if (typeof zone !== "string" || !zone) return "Europe/London";
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return zone;
  } catch {
    return "Europe/London";
  }
}

export function createSession(options: { timeZone: string; email?: string; firstName?: string; lastName?: string; method?: "password" | OAuthProvider; onboarded?: boolean }): PreviewSession {
  const id = encodeSessionId(options.timeZone);
  const account = buildSampleAccount(new Date(), options.timeZone);
  if (options.email) account.account.email = options.email.trim().toLowerCase();
  if (options.firstName) {
    account.profile.profile.firstName = options.firstName;
    account.profile.profile.lastName = options.lastName ?? "";
  }
  if (options.method && options.method !== "password") account.account.signInMethods = [options.method];
  account.account.onboardingCompleted = options.onboarded ?? true;
  // A brand-new account picks its own goals and privacy choices during onboarding.
  if (!account.account.onboardingCompleted) {
    account.profile.profile.goals = [];
    for (const consent of account.consents) consent.granted = false;
  }
  const session: PreviewSession = { id, account, processing: new Map() };
  store.sessions.set(id, session);
  return session;
}

/** The session for an id, rebuilt from the sample data if the server restarted. */
export function getSession(sessionId: string | null): PreviewSession | null {
  if (!sessionId) return null;
  const existing = store.sessions.get(sessionId);
  if (existing) return existing;
  if (!/^[a-f0-9]{20}~[A-Za-z0-9_-]+$/.test(sessionId)) return null;
  const session: PreviewSession = { id: sessionId, account: buildSampleAccount(new Date(), timeZoneOf(sessionId)), processing: new Map() };
  store.sessions.set(sessionId, session);
  return session;
}

export function endSession(sessionId: string) {
  store.sessions.delete(sessionId);
}

export function addPendingSignup(input: Omit<PendingSignup, "token">): PendingSignup {
  const pending = { ...input, email: input.email.trim().toLowerCase(), token: randomId() };
  store.pending.set(pending.email, pending);
  return pending;
}

export function pendingByEmail(email: string) {
  return store.pending.get(email.trim().toLowerCase()) ?? null;
}

export function takePendingByToken(token: string): PendingSignup | null {
  for (const pending of store.pending.values()) {
    if (pending.token === token) {
      store.pending.delete(pending.email);
      return pending;
    }
  }
  return null;
}

export function createResetToken(email: string) {
  const token = randomId();
  store.resets.set(token, email.trim().toLowerCase());
  return token;
}

export function takeResetToken(token: string) {
  const email = store.resets.get(token) ?? null;
  store.resets.delete(token);
  return email;
}

export function sendEmail(email: Omit<PreviewEmail, "id" | "sentAt">) {
  store.inbox.unshift({ ...email, to: email.to.trim().toLowerCase(), id: randomId(), sentAt: new Date().toISOString() });
  store.inbox.length = Math.min(store.inbox.length, 50);
}

export function inboxFor(email: string) {
  const address = email.trim().toLowerCase();
  return store.inbox.filter((m) => m.to === address);
}

export { SAMPLE_EMAIL };
