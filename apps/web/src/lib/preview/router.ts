import { escalationMessage, MEDICATION_CHANGE_NOTICE, triage } from "@healthmate/safety";
import { localDay, SAMPLE_NOTICE, type SampleAccount } from "@healthmate/sample-data";
import type {
  AccountSummary,
  AppointmentRecord,
  AssistantAnswer,
  AssistantPayload,
  CareProviderRecord,
  ChatMessageRecord,
  ConsentKind,
  ConversationDetail,
  DocumentRecord,
  HealthProfile,
  MeasurementKind,
  MemoryRecord,
  NotificationPreferences,
  PlanRecord,
  TimelineEventRecord,
  TrendResponse,
} from "@healthmate/shared-types";
import type { PreviewControls } from "./controls";
import { previewTokens, sessionIdFromToken } from "./mode";
import {
  addPendingSignup,
  createResetToken,
  createSession,
  endSession,
  getSession,
  inboxFor,
  pendingByEmail,
  SAMPLE_EMAIL,
  sendEmail,
  takePendingByToken,
  takeResetToken,
  validTimeZone,
  type PreviewSession,
} from "./store";

/**
 * The HealthMate REST API, answered locally from the sample account (Preview
 * mode, Phase 1). Same paths, bodies and response shapes as services/api, so
 * screens don't change when Phase 2 switches to the real API. Nothing here is
 * real AI or real analysis: replies and results are fixed samples, labelled.
 */
export async function previewFetch(path: string, method: string, body: unknown, token: string | undefined, controls: PreviewControls): Promise<Response> {
  if (controls.state === "loading") await sleep(3000);
  if (controls.state === "slow") await sleep(900);
  if (controls.state === "offline") throw new TypeError("fetch failed (Preview: offline)");

  const url = new URL(path.replace(/^\//, ""), "http://preview.local/");
  const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const route = segments.join("/");
  const input = (body ?? {}) as Record<string, unknown>;

  // "AI unavailable": the assistant can't answer; everything else (and emergency triage in the app) still works.
  if (controls.state === "ai_unavailable") {
    if (method === "GET" && route === "meta") return json({ apiVersion: 1, ai: { available: false, demo: true }, preview: true });
    if (method === "POST" && (route === "conversations" || /^conversations\/[^/]+\/messages$/.test(route))) {
      return fail(503, "ai_unavailable", "The AI Health Assistant is unavailable right now. Please try again later.");
    }
  }

  const publicResponse = publicRoute(method, segments, input, url);
  if (publicResponse) return publicResponse;

  if (controls.state === "error" && !["me", "meta", "me/account"].includes(route)) {
    return fail(500, "internal", "Something went wrong on our side. Please try again.");
  }

  const session = getSession(sessionIdFromToken(token));
  if (!session) return fail(401, "unauthorized", "Please sign in again.");
  const ctx: Context = { session, view: viewOf(session.account, controls), input, url, controls };
  settleProcessing(session);
  return authedRoute(method, segments, ctx) ?? fail(404, "not_found", "Not found.");
}

interface Context {
  session: PreviewSession;
  /** What reads see: the account, or an empty / permissions-off version of it. */
  view: SampleAccount;
  input: Record<string, unknown>;
  url: URL;
  controls: PreviewControls;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const noContent = () => new Response(null, { status: 204 });
const fail = (status: number, code: string, message: string) => json({ error: { code, message } }, status);
const nowIso = () => new Date().toISOString();
const newId = () => crypto.randomUUID();
const text = (value: unknown, max = 2000) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const optionalText = (value: unknown, max = 2000) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);

function viewOf(account: SampleAccount, controls: PreviewControls): SampleAccount {
  if (controls.state === "empty") {
    return {
      ...account,
      profile: { profile: account.profile.profile, conditions: [], allergies: [], medications: [] },
      memories: [],
      conversations: [],
      documents: [],
      measurements: { latest: [], daily: {} },
      timeline: [],
      plan: { revision: account.plan.revision, items: [], completions: [] },
      moods: [],
      providers: [],
      appointments: [],
      symptoms: [],
      notifications: [],
      healthKit: { status: "never_connected", deviceName: null, scopes: [], connectedAt: null, disconnectedAt: null, lastSyncAt: null },
    };
  }
  if (controls.state === "permission") {
    return {
      ...account,
      consents: account.consents.map((c) => ({ ...c, granted: false })),
      healthKit: { ...account.healthKit, status: "disconnected", disconnectedAt: nowIso() },
      measurements: { latest: [], daily: {} },
    };
  }
  return account;
}

/** Sample analyses finish a few seconds after upload. */
function settleProcessing(session: PreviewSession) {
  const now = Date.now();
  for (const [id, readyAt] of session.processing) {
    if (readyAt > now) continue;
    session.processing.delete(id);
    const doc = session.account.documents.find((d) => d.id === id);
    if (!doc) continue;
    const { sampleAnalyses } = session.account;
    const unclear = /blur|unreadable|dark/i.test(doc.filename);
    doc.result = doc.kind === "image" ? (unclear ? sampleAnalyses.poorImage : sampleAnalyses.image) : unclear ? sampleAnalyses.unreadableReport : sampleAnalyses.report;
    doc.status = "ready";
    doc.processedAt = nowIso();
    session.account.notifications.unshift({
      id: newId(),
      category: "report",
      title: `Summary ready: ${doc.filename}`,
      body: "Tap to see the sample summary.",
      createdAt: nowIso(),
      readAt: null,
      link: `/reports/${doc.id}`,
      aiGenerated: false,
    });
    session.account.timeline.unshift({ id: newId(), eventType: doc.kind === "image" ? "image" : "report", title: `${doc.filename} ${doc.kind === "image" ? "checked" : "analysed"}`, occurredAt: nowIso(), sourceType: "document", sourceId: doc.id });
  }
}

function tokensFor(session: PreviewSession) {
  return { userId: session.account.account.email, ...previewTokens(session.id) };
}

// ── Public routes (no session) ──────────────────────────────────────────────

function publicRoute(method: string, s: string[], input: Record<string, unknown>, url: URL): Response | null {
  const route = s.join("/");
  if (method === "GET" && route === "meta") return json({ apiVersion: 1, ai: { available: true, demo: true }, preview: true });
  if (s[0] !== "auth" && route !== "preview/inbox") return null;

  if (method === "GET" && route === "preview/inbox") return json({ emails: inboxFor(text(url.searchParams.get("email"), 254)) });

  if (method !== "POST") return null;
  const email = text(input.email, 254).toLowerCase();
  const password = typeof input.password === "string" ? input.password : "";
  const timeZone = validTimeZone(input.timeZone);

  switch (route) {
    case "auth/register": {
      if (!email.includes("@")) return fail(400, "validation_failed", "Enter a valid email address.");
      if (password.length < 8) return fail(400, "validation_failed", "Use at least 8 characters for your password.");
      if (email === SAMPLE_EMAIL) return fail(409, "conflict", "An account with this email already exists. Try signing in.");
      const pending = addPendingSignup({ email, firstName: text(input.firstName, 80) || "Alex", lastName: text(input.lastName, 80), timeZone });
      sendEmail({
        to: email,
        subject: "Confirm your email for HealthMate",
        body: `Hi ${pending.firstName}, confirm your email address to finish creating your HealthMate account.`,
        link: `/verify-email/confirm?token=${pending.token}`,
        linkLabel: "Confirm email address",
      });
      return json({ confirmationRequired: true }, 202);
    }
    case "auth/resend-verification": {
      const pending = pendingByEmail(email);
      if (pending) {
        sendEmail({ to: pending.email, subject: "Confirm your email for HealthMate", body: "Here's a new link to confirm your email address.", link: `/verify-email/confirm?token=${pending.token}`, linkLabel: "Confirm email address" });
      }
      return json({ ok: true }, 202);
    }
    case "auth/verify-email": {
      const pending = takePendingByToken(text(input.token, 200));
      if (!pending) return fail(400, "invalid_token", "This link is invalid or has already been used. Sign in, or request a new link.");
      const session = createSession({ timeZone: pending.timeZone, email: pending.email, firstName: pending.firstName, lastName: pending.lastName, onboarded: false });
      return json(tokensFor(session));
    }
    case "auth/login": {
      if (password.length < 8 || password === "wrong-password") return fail(401, "unauthorized", "Email or password is incorrect.");
      if (pendingByEmail(email)) return fail(401, "email_not_confirmed", "Confirm your email address first — check your inbox for the link.");
      const session = createSession({ timeZone, email: email || SAMPLE_EMAIL });
      return json(tokensFor(session));
    }
    case "auth/oauth": {
      const provider = input.provider === "google" || input.provider === "apple" ? input.provider : null;
      if (!provider) return fail(400, "validation_failed", "Unknown sign-in provider.");
      const session = createSession({ timeZone, method: provider, onboarded: input.newAccount !== false ? false : true });
      return json({ ...tokensFor(session), isNewUser: true });
    }
    case "auth/refresh": {
      const session = getSession(sessionIdFromToken(text(input.refreshToken, 400)));
      return session ? json(previewTokens(session.id)) : fail(401, "unauthorized", "Please sign in again.");
    }
    case "auth/logout":
      return noContent();
    case "auth/password-reset": {
      if (email.includes("@")) {
        const token = createResetToken(email);
        sendEmail({ to: email, subject: "Reset your HealthMate password", body: "Someone asked to reset the password for this account. If it was you, choose a new password.", link: `/reset-password#access_token=${token}&type=recovery`, linkLabel: "Choose a new password" });
      }
      return json({ ok: true }, 202);
    }
    case "auth/password-reset/complete": {
      if (password.length < 8) return fail(400, "validation_failed", "Choose a longer or less common password.");
      return takeResetToken(text(input.accessToken, 400)) ? noContent() : fail(401, "unauthorized", "This reset link is invalid or has expired. Request a new one.");
    }
    default:
      return null;
  }
}

// ── Signed-in routes ────────────────────────────────────────────────────────

function authedRoute(method: string, s: string[], ctx: Context): Response | null {
  const { session, view, input } = ctx;
  const account = session.account;
  const [a, b, c, d] = s;

  // Account & profile
  if (a === "auth" && b === "change-password" && method === "POST") {
    if (input.currentPassword === "wrong-password") return fail(403, "forbidden", "Your current password is incorrect.");
    if (text(input.newPassword).length < 8) return fail(400, "validation_failed", "Use at least 8 characters for your new password.");
    return noContent();
  }
  if (a === "me") {
    if (!b && method === "GET") return json(view.profile satisfies HealthProfile);
    if (b === "account" && method === "GET") return json(account.account satisfies AccountSummary);
    if (b === "onboarding" && method === "POST") {
      account.account.onboardingCompleted = true;
      return noContent();
    }
    if (b === "profile" && method === "PATCH") {
      const p = account.profile.profile;
      if (typeof input.firstName === "string") p.firstName = text(input.firstName, 80);
      if (typeof input.lastName === "string") p.lastName = text(input.lastName, 80);
      if (input.dateOfBirth !== undefined) p.dateOfBirth = optionalText(input.dateOfBirth, 10);
      if (input.sex !== undefined) p.sex = optionalText(input.sex, 40);
      if (input.heightCm !== undefined) p.heightCm = typeof input.heightCm === "number" ? input.heightCm : null;
      if (typeof input.timeZone === "string") p.timeZone = validTimeZone(input.timeZone);
      if (Array.isArray(input.goals)) p.goals = input.goals.filter((g): g is string => typeof g === "string").slice(0, 10);
      return json(account.profile.profile);
    }
    if (b === "conditions" && method === "POST") {
      const id = newId();
      account.profile.conditions.push({ id, name: text(input.name, 120), status: input.status === "resolved" ? "resolved" : "active", source: "user_reported", notes: optionalText(input.notes, 500) });
      return json({ id }, 201);
    }
    if (b === "allergies" && method === "POST") {
      const id = newId();
      account.profile.allergies.push({ id, substance: text(input.substance, 120), reaction: optionalText(input.reaction, 200), severity: optionalText(input.severity, 20), source: "user_reported" });
      return json({ id }, 201);
    }
    if (b === "medications" && method === "POST") {
      const id = newId();
      // Stored exactly as entered — never generated or changed.
      account.profile.medications.push({ id, name: text(input.name, 120), instruction: typeof input.instruction === "string" ? input.instruction : "", source: input.source === "clinician_provided" ? "clinician_provided" : "user_reported", active: true });
      return json({ id }, 201);
    }
    if (b === "medications" && c && method === "PATCH") {
      const med = account.profile.medications.find((m) => m.id === c);
      if (!med) return fail(404, "not_found", "Medication not found.");
      med.active = input.active === true;
      return noContent();
    }
    if ((b === "conditions" || b === "allergies" || b === "medications") && c && method === "DELETE") {
      const list = account.profile[b] as { id: string }[];
      const index = list.findIndex((x) => x.id === c);
      if (index < 0) return fail(404, "not_found", "Not found.");
      list.splice(index, 1);
      return noContent();
    }
    if (b === "consents" && method === "GET") return json(view.consents.map((x) => ({ ...x, updatedAt: nowIso() })));
    if (b === "consents" && method === "POST") {
      const kind = input.kind as ConsentKind;
      const consent = account.consents.find((x) => x.kind === kind);
      if (!consent) return fail(400, "validation_failed", "Unknown consent.");
      consent.granted = input.granted === true;
      return noContent();
    }
    if (b === "notification-preferences" && method === "GET") return json(account.notificationPreferences);
    if (b === "notification-preferences" && method === "PUT") {
      account.notificationPreferences = { ...account.notificationPreferences, ...(input as Partial<NotificationPreferences>) };
      return json(account.notificationPreferences);
    }
    if (b === "export" && method === "GET") {
      const data: Partial<SampleAccount> = { ...account };
      delete data.replies;
      delete data.fallbackReply;
      delete data.sampleAnalyses;
      return json({ exportedAt: nowIso(), format: "healthmate-export-v1", preview: true, ...data });
    }
    if (b === "delete" && method === "POST") {
      if (input.password === "wrong-password" || text(input.password).length < 8) return fail(403, "forbidden", "Password is incorrect.");
      endSession(session.id);
      return noContent();
    }
  }

  // Health memory
  if (a === "memories") {
    if (!b && method === "GET") {
      const q = text(ctx.url.searchParams.get("q"), 200).toLowerCase();
      return json(q ? view.memories.filter((m) => m.fact.toLowerCase().includes(q)) : view.memories);
    }
    if (!b && method === "POST") {
      const memory: MemoryRecord = { id: newId(), fact: text(input.fact, 500), source: text(input.source, 40) || "user_entry", status: input.status === "user_confirmed" ? "user_confirmed" : "user_reported", createdAt: nowIso() };
      account.memories.unshift(memory);
      return json(memory, 201);
    }
    const memory = account.memories.find((m) => m.id === b);
    if (b && !memory) return fail(404, "not_found", "Memory not found.");
    if (memory && method === "PATCH") {
      if (typeof input.fact === "string" && input.fact.trim()) memory.fact = text(input.fact, 500);
      // Only the person's explicit action confirms a memory.
      if (input.confirm === true || typeof input.fact === "string") memory.status = "user_confirmed";
      return json(memory);
    }
    if (memory && method === "DELETE") {
      account.memories.splice(account.memories.indexOf(memory), 1);
      return noContent();
    }
  }

  // Chat
  if (a === "conversations") {
    if (!b && method === "GET") {
      return json(view.conversations.map((x) => x.conversation).sort((x, y) => y.updatedAt.localeCompare(x.updatedAt)));
    }
    if (!b && method === "POST") {
      const message = text(input.message, 4000);
      if (!message) return fail(400, "validation_failed", "Type a message first.");
      const now = nowIso();
      const detail: ConversationDetail = { conversation: { id: newId(), title: message.replace(/\s+/g, " ").slice(0, 60), createdAt: now, updatedAt: now }, messages: exchange(account, message) };
      account.conversations.unshift(detail);
      account.timeline.unshift({ id: newId(), eventType: "chat", title: `AI chat: ${detail.conversation.title}`, occurredAt: now, sourceType: "user_entered", sourceId: detail.conversation.id });
      return json(detail, 201);
    }
    const conversation = view.conversations.find((x) => x.conversation.id === b);
    if (b && !conversation) return fail(404, "not_found", "Conversation not found.");
    if (conversation && !c && method === "GET") return json(conversation);
    if (conversation && c === "messages" && method === "POST") {
      const message = text(input.message, 4000);
      if (!message) return fail(400, "validation_failed", "Type a message first.");
      const messages = exchange(account, message);
      conversation.messages.push(...messages);
      conversation.conversation.updatedAt = nowIso();
      return json({ messages }, 201);
    }
    if (conversation && method === "DELETE") {
      account.conversations.splice(account.conversations.indexOf(conversation), 1);
      return noContent();
    }
    if (conversation && !c && method === "PATCH") {
      conversation.conversation.title = text(input.title, 80) || conversation.conversation.title;
      return json(conversation.conversation);
    }
  }

  // Reports & photos
  if (a === "documents") {
    if (!b && method === "GET") {
      const kind = ctx.url.searchParams.get("kind");
      return json(view.documents.filter((x) => !kind || x.kind === kind).sort((x, y) => y.createdAt.localeCompare(x.createdAt)));
    }
    if (!b && method === "POST") {
      const kind = input.kind === "image" ? "image" : "report";
      const contentType = text(input.contentType, 100);
      const allowed = kind === "image" ? ["image/jpeg", "image/png"] : ["application/pdf", "image/jpeg", "image/png"];
      if (!allowed.includes(contentType)) return fail(415, "unsupported_media_type", kind === "image" ? "Upload a JPG or PNG photo." : "Upload a PDF, JPG or PNG.");
      const byteSize = typeof input.byteSize === "number" ? input.byteSize : 0;
      if (byteSize <= 0 || byteSize > 20 * 1024 * 1024) return fail(413, "payload_too_large", "Files must be smaller than 20 MB.");
      const doc: DocumentRecord = {
        id: newId(),
        kind,
        purpose: kind === "image" ? ((input.purpose as DocumentRecord["purpose"]) ?? "other") : null,
        filename: text(input.filename, 255) || "upload",
        contentType,
        byteSize,
        status: "awaiting_upload",
        failureReason: null,
        result: null,
        createdAt: nowIso(),
        processedAt: null,
      };
      account.documents.unshift(doc);
      return json({ document: doc, upload: { method: "PUT", url: `preview-upload://${doc.id}`, headers: { "Content-Type": contentType } } }, 201);
    }
    const doc = view.documents.find((x) => x.id === b);
    if (b && !doc) return fail(404, "not_found", "File not found.");
    if (doc && c === "process" && method === "POST") {
      doc.status = "processing";
      session.processing.set(doc.id, Date.now() + 4000);
      return json(doc, 202);
    }
    if (doc && c === "file" && method === "GET") {
      return json({ url: doc.kind === "image" || doc.contentType.startsWith("image/") ? "/preview/example-photo.svg" : "/preview/example-report.pdf", expiresIn: 300 });
    }
    if (doc && !c && method === "GET") return json(doc);
    if (doc && !c && method === "DELETE") {
      account.documents.splice(account.documents.indexOf(doc), 1);
      return noContent();
    }
  }

  // Health data
  if (a === "health-data") {
    if (b === "latest" && method === "GET") return json(view.measurements.latest);
    if (b === "trends" && method === "GET") return json(trend(view, ctx.url));
    if (b === "measurements" && method === "POST") {
      const list = Array.isArray(input.measurements) ? (input.measurements as { kind: MeasurementKind; value: number; recordedAt: string; source: string }[]) : [];
      for (const m of list) {
        if (typeof m.value !== "number" || !Number.isFinite(m.value) || typeof m.recordedAt !== "string") continue;
        account.measurements.latest = [...account.measurements.latest.filter((x) => x.kind !== m.kind), { kind: m.kind, value: m.value, unit: account.measurements.latest.find((x) => x.kind === m.kind)?.unit ?? "", recordedAt: m.recordedAt, source: m.source }];
        // A reading becomes part of that day's history (replacing the day's value, like a daily summary).
        const date = localDay(new Date(m.recordedAt), account.profile.profile.timeZone);
        const series = (account.measurements.daily[m.kind] ??= []);
        const point = { date, value: m.value, min: m.value, max: m.value, count: 1 };
        const index = series.findIndex((p) => p.date === date);
        if (index >= 0) series[index] = point;
        else {
          series.push(point);
          series.sort((x, y) => x.date.localeCompare(y.date));
        }
        account.timeline.unshift({ id: newId(), eventType: "measurement", title: `${measurementTitle(m.kind)} added by you`, occurredAt: m.recordedAt, sourceType: "user_entered", sourceId: null, payload: { kind: m.kind } });
      }
      return json({ inserted: list.length }, 201);
    }
    if (b === "apple-health" && method === "DELETE") return disconnectHealthKit(account);
  }
  if (a === "healthkit" && b === "connection") {
    if (method === "GET") return json(view.healthKit);
    if (method === "PUT") {
      account.healthKit = { ...account.healthKit, status: "connected", deviceName: optionalText(input.deviceName, 120) ?? account.healthKit.deviceName, scopes: Array.isArray(input.scopes) ? (input.scopes as MeasurementKind[]) : account.healthKit.scopes, connectedAt: nowIso(), disconnectedAt: null, lastSyncAt: nowIso() };
      return json(account.healthKit);
    }
    if (method === "DELETE") return disconnectHealthKit(account);
  }

  // Timeline
  if (a === "timeline") {
    if (!b && method === "GET") {
      const before = ctx.url.searchParams.get("before");
      const types = ctx.url.searchParams.get("types")?.split(",").filter(Boolean);
      const limit = Math.min(Number(ctx.url.searchParams.get("limit")) || 50, 100);
      const events = [...view.timeline].sort((x, y) => y.occurredAt.localeCompare(x.occurredAt)).filter((e) => (!before || e.occurredAt < before) && (!types?.length || types.includes(e.eventType)));
      const page = events.slice(0, limit);
      return json({ events: page, nextCursor: events.length > limit ? page.at(-1)!.occurredAt : null });
    }
    if (!b && method === "POST") {
      const entry: TimelineEventRecord = { id: newId(), eventType: (input.eventType as TimelineEventRecord["eventType"]) ?? "note", title: text(input.title, 200), occurredAt: optionalText(input.occurredAt, 40) ?? nowIso(), sourceType: "user_entered", sourceId: null, payload: (input.payload as Record<string, unknown>) ?? null };
      account.timeline.unshift(entry);
      return json({ id: entry.id }, 201);
    }
    const entry = account.timeline.find((e) => e.id === b);
    if (b && !entry) return fail(404, "not_found", "Entry not found.");
    if (entry && method === "GET") return json(entry);
    if (entry && method === "DELETE") {
      if (entry.sourceType !== "user_entered") return fail(403, "forbidden", "Only entries you added can be deleted.");
      account.timeline.splice(account.timeline.indexOf(entry), 1);
      return noContent();
    }
  }

  // Plan, reminders, mood
  if (a === "plan" && !b) {
    if (method === "GET") return json(view.plan);
    if (method === "PUT") {
      if (input.baseRevision !== account.plan.revision) return fail(409, "plan_conflict", "Your plan was changed somewhere else. Reload and try again.");
      account.plan = { revision: account.plan.revision + 1, items: (input.items as PlanRecord["items"]) ?? [], completions: (input.completions as PlanRecord["completions"]) ?? [] };
      return json(account.plan);
    }
  }
  if (a === "reminders" && !b && method === "GET") {
    return json(view.plan.items.map((i) => ({ id: `r-${i.id}`, planItemId: i.id, title: i.title, time: i.time, enabled: i.reminderEnabled, channel: "device" })));
  }
  if (a === "check-ins" && b === "mood") {
    if (!c && method === "POST") {
      const checkIn = { mood: input.mood as SampleAccount["moods"][number]["mood"], recordedAt: nowIso() };
      account.moods.unshift(checkIn);
      return json(checkIn, 201);
    }
    if (c === "latest" && method === "GET") return json({ checkIn: view.moods[0] ?? null });
  }

  // Care
  if (a === "care" && b === "providers") {
    if (!c && method === "GET") return json(view.providers);
    if (!c && method === "POST") {
      const provider: CareProviderRecord = { id: newId(), name: text(input.name, 160), specialty: optionalText(input.specialty, 120), phone: optionalText(input.phone, 40), address: optionalText(input.address, 300), website: optionalText(input.website, 300), notes: optionalText(input.notes, 1000), createdAt: nowIso() };
      account.providers.push(provider);
      return json({ id: provider.id }, 201);
    }
    const provider = view.providers.find((p) => p.id === c);
    if (c && !provider) return fail(404, "not_found", "Care provider not found.");
    if (provider && method === "GET") return json(provider);
    if (provider && method === "PATCH") {
      Object.assign(provider, pick(input, ["name", "specialty", "phone", "address", "website", "notes"]));
      return json(provider);
    }
    if (provider && method === "DELETE") {
      account.providers.splice(account.providers.indexOf(provider), 1);
      return noContent();
    }
  }
  if (a === "care" && b === "appointments") {
    if (!c && method === "GET") {
      const when = ctx.url.searchParams.get("when") ?? "upcoming";
      const now = nowIso();
      const list = view.appointments.filter((x) => when === "all" || (when === "past" ? x.startsAt < now : x.startsAt >= now));
      return json(list.sort((x, y) => (when === "past" ? y.startsAt.localeCompare(x.startsAt) : x.startsAt.localeCompare(y.startsAt))));
    }
    if (!c && method === "POST") {
      const providerId = optionalText(input.careProviderId, 40);
      const appointment: AppointmentRecord = {
        id: newId(),
        title: text(input.title, 200),
        careProviderId: providerId,
        providerName: account.providers.find((p) => p.id === providerId)?.name ?? null,
        startsAt: text(input.startsAt, 40),
        endsAt: optionalText(input.endsAt, 40),
        location: optionalText(input.location, 300),
        mode: (input.mode as AppointmentRecord["mode"]) ?? null,
        status: "scheduled",
        notes: optionalText(input.notes, 1000),
      };
      account.appointments.push(appointment);
      account.timeline.unshift({ id: newId(), eventType: "appointment", title: appointment.title, occurredAt: appointment.startsAt, sourceType: "user_entered", sourceId: appointment.id });
      return json({ id: appointment.id }, 201);
    }
    const appointment = view.appointments.find((x) => x.id === c);
    if (c && !appointment) return fail(404, "not_found", "Appointment not found.");
    if (appointment && method === "GET") return json(appointment);
    if (appointment && method === "PATCH") {
      Object.assign(appointment, pick(input, ["title", "status", "startsAt", "endsAt", "location", "mode", "notes", "careProviderId"]));
      appointment.providerName = account.providers.find((p) => p.id === appointment.careProviderId)?.name ?? appointment.providerName;
      return json(appointment);
    }
    if (appointment && method === "DELETE") {
      account.appointments.splice(account.appointments.indexOf(appointment), 1);
      return noContent();
    }
  }

  // Symptoms
  if (a === "symptoms") {
    if (!b && method === "GET") {
      const status = ctx.url.searchParams.get("status");
      return json(view.symptoms.filter((x) => !status || x.status === status).map((symptom) => ({ ...symptom, events: undefined })));
    }
    if (!b && method === "POST") {
      const name = text(input.name, 120);
      const existing = account.symptoms.find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (existing) {
        existing.status = "active";
        return json({ id: existing.id }, 201);
      }
      const id = newId();
      account.symptoms.unshift({ id, name, bodyArea: optionalText(input.bodyArea, 80), status: "active", notes: optionalText(input.notes, 1000), firstNotedOn: optionalText(input.firstNotedOn, 10), createdAt: nowIso(), lastLoggedAt: null, lastSeverity: null, events: [] });
      return json({ id }, 201);
    }
    const symptom = view.symptoms.find((x) => x.id === b);
    if (b && !symptom) return fail(404, "not_found", "Symptom not found.");
    if (symptom && c === "events" && method === "GET") return json(symptom.events);
    if (symptom && c === "events" && method === "POST") {
      const notes = optionalText(input.notes, 1000);
      const result = triage([symptom.name, notes ?? ""].join(". "));
      const occurredAt = optionalText(input.occurredAt, 40) ?? nowIso();
      const severity = typeof input.severity === "number" ? input.severity : null;
      const event = { id: newId(), severity, occurredAt, notes, triageLevel: result.level };
      symptom.events.unshift(event);
      symptom.lastLoggedAt = occurredAt;
      symptom.lastSeverity = severity;
      account.timeline.unshift({ id: newId(), eventType: "symptom", title: symptom.name, occurredAt, sourceType: "user_entered", sourceId: event.id, payload: severity === null ? null : { severity } });
      return json({ id: event.id, triageLevel: result.level, escalation: escalationMessage(result) }, 201);
    }
    if (symptom && !c && method === "PATCH") {
      if (input.status === "active" || input.status === "resolved") symptom.status = input.status;
      if (input.notes !== undefined) symptom.notes = optionalText(input.notes, 1000);
      return noContent();
    }
    if (symptom && !c && method === "DELETE") {
      account.symptoms.splice(account.symptoms.indexOf(symptom), 1);
      return noContent();
    }
  }

  // Notifications
  if (a === "notifications") {
    if (!b && method === "GET") {
      const list = [...view.notifications].sort((x, y) => y.createdAt.localeCompare(x.createdAt));
      return json({ notifications: list, unreadCount: list.filter((n) => !n.readAt).length });
    }
    if (b === "read-all" && method === "POST") {
      for (const n of account.notifications) n.readAt ??= nowIso();
      return noContent();
    }
    const notification = account.notifications.find((n) => n.id === b);
    if (b && !notification) return fail(404, "not_found", "Notification not found.");
    if (notification && method === "PATCH") {
      notification.readAt = input.read === false ? null : (notification.readAt ?? nowIso());
      return json(notification);
    }
    if (notification && method === "DELETE") {
      account.notifications.splice(account.notifications.indexOf(notification), 1);
      return noContent();
    }
  }

  void d;
  return null;
}

function measurementTitle(kind: MeasurementKind) {
  const titles: Partial<Record<MeasurementKind, string>> = { weight: "Weight", resting_heart_rate: "Resting heart rate", sleep: "Sleep", steps: "Steps", heart_rate: "Heart rate", active_energy: "Active energy" };
  return titles[kind] ?? "Reading";
}

function pick(input: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.filter((k) => input[k] !== undefined).map((k) => [k, input[k]]));
}

function disconnectHealthKit(account: SampleAccount) {
  account.healthKit = { ...account.healthKit, status: "disconnected", disconnectedAt: nowIso() };
  return json({ removed: 0 });
}

function trend(view: SampleAccount, url: URL): TrendResponse {
  const kind = (url.searchParams.get("kind") ?? "steps") as MeasurementKind;
  const days = Math.min(Math.max(Number(url.searchParams.get("days")) || 7, 1), 90);
  const series = view.measurements.daily[kind] ?? [];
  const points = series.slice(-days);
  const previous = series.slice(-days * 2, -days);
  const avg = (values: number[]) => (values.length ? values.reduce((x, y) => x + y, 0) / values.length : null);
  const unit = view.measurements.latest.find((m) => m.kind === kind)?.unit ?? "";
  return { kind, unit, points, average: avg(points.map((p) => p.value)), previousAverage: avg(previous.map((p) => p.value)) };
}

/**
 * The same safety order as the real AI Gateway: deterministic triage first
 * (emergencies get fixed guidance), then a fixed sample reply — never an AI.
 */
function exchange(account: SampleAccount, message: string): ChatMessageRecord[] {
  const now = nowIso();
  const result = triage(message);
  const user: ChatMessageRecord = { id: newId(), role: "user", content: message, payload: null, triageLevel: result.level, createdAt: now };
  const escalation = escalationMessage(result);
  let payload: AssistantPayload;
  if (result.level === "emergency" && escalation) {
    payload = { kind: "escalation", escalation };
  } else if (result.medicationChangeRequest) {
    payload = { ...account.fallbackReply, answer: MEDICATION_CHANGE_NOTICE, followUp: null, notice: SAMPLE_NOTICE, escalation, safetyAdjusted: true } satisfies AssistantAnswer;
  } else {
    const lower = message.toLowerCase();
    const reply = account.replies.find((r) => r.keywords.some((k) => lower.includes(k)))?.answer ?? account.fallbackReply;
    payload = { ...reply, escalation };
  }
  const content = payload.kind === "escalation" ? `${payload.escalation.title}\n\n${payload.escalation.body}` : payload.answer;
  const assistant: ChatMessageRecord = { id: newId(), role: "assistant", content, payload, triageLevel: result.level, createdAt: nowIso() };
  return [user, assistant];
}
