import { escalationMessage, MEDICATION_CHANGE_NOTICE, reviewAssistantText, triage, type EscalationMessage, type TriageResult } from "@healthmate/safety";
import { Inject, Injectable } from "@nestjs/common";
import { notFound } from "../../common/errors";
import { DATABASE, type Database, type Queryable } from "../../db/database";
import { AiGateway } from "../ai/ai.gateway";
import type { AiMessage } from "../ai/ai.types";
import { dailyHealthContext, relevantMetrics } from "../health-data/daily-health-context";
import { HealthDataService } from "../health-data/health-data.service";
import { renderMemoryContext } from "../memory/memory-retrieval";
import { MemoryService } from "../memory/memory.service";
import { localDay, ProfileService } from "../profile/profile.service";
import { TimelineService } from "../timeline/timeline.service";
import { CHAT_SYSTEM_PROMPT, ChatAnswerSchema, contextBlock, REWRITE_NOTE, SAFE_FALLBACK_ANSWER, safetyNotes, type ChatAnswer } from "./chat.prompts";

/** What the client renders for an assistant turn. */
export type AssistantPayload =
  | { kind: "escalation"; escalation: EscalationMessage }
  | {
      kind: "answer";
      answer: string;
      followUp: ChatAnswer["followUp"];
      warningSigns: string[];
      careRecommendation: ChatAnswer["careRecommendation"];
      memorySuggestions: { fact: string }[];
      /** What the answer was based on (shown as "based on …"; the facts are the person's own). */
      context?: AnswerContext;
      /** Deterministic banner shown above the answer for urgent triage. */
      escalation: EscalationMessage | null;
      /** Fixed notice when the person asked about changing medication. */
      notice: string | null;
      /** True when a safety check replaced the model's answer. */
      safetyAdjusted: boolean;
    };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  payload: AssistantPayload | null;
  triageLevel: string | null;
  createdAt: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

const HISTORY_LIMIT = 20;

/** What an answer was based on — the few facts retrieved, not the whole history. */
export interface AnswerContext {
  memories: { id: string; fact: string; status: string; temporalStatus: "current" | "historical"; occurredOn: string | null }[];
  usedProfile: boolean;
  /** Daily health metrics summarised for this answer (e.g. "sleep"). */
  healthMetrics: string[];
}

type MessageRow = { id: string; role: "user" | "assistant"; content: string; structured: AssistantPayload | null; triage_level: string | null; created_at: Date };
const toMessage = (r: MessageRow): ChatMessage => ({ id: r.id, role: r.role, content: r.content, payload: r.structured, triageLevel: r.triage_level, createdAt: r.created_at.toISOString() });

const shiftDay = (day: string, offset: number) => new Date(Date.parse(`${day}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);

@Injectable()
export class ChatService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(AiGateway) private readonly ai: AiGateway,
    @Inject(ProfileService) private readonly profiles: ProfileService,
    @Inject(MemoryService) private readonly memories: MemoryService,
    @Inject(TimelineService) private readonly timeline: TimelineService,
    @Inject(HealthDataService) private readonly healthData: HealthDataService,
  ) {}

  /** Renames a conversation (the person's own label; nothing about the content changes). */
  async rename(userId: string, id: string, title: string): Promise<Conversation> {
    const { rows } = await this.db.query<{ id: string; title: string; created_at: Date; updated_at: Date }>(
      `UPDATE conversations SET title = $3 WHERE id = $2 AND user_id = $1 RETURNING id, title, created_at, updated_at`,
      [userId, id, title],
    );
    const r = rows[0];
    if (!r) throw notFound("Conversation");
    return { id: r.id, title: r.title, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString() };
  }

  async list(userId: string): Promise<Conversation[]> {
    const { rows } = await this.db.query<{ id: string; title: string; created_at: Date; updated_at: Date }>(
      `SELECT id, title, created_at, updated_at FROM conversations WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 100`,
      [userId],
    );
    return rows.map((r) => ({ id: r.id, title: r.title, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString() }));
  }

  async get(userId: string, conversationId: string): Promise<{ conversation: Conversation; messages: ChatMessage[] }> {
    const conversation = await this.findConversation(userId, conversationId);
    const { rows } = await this.db.query<MessageRow>(
      `SELECT id, role, content, structured, triage_level, created_at FROM messages WHERE conversation_id = $1 AND user_id = $2 ORDER BY created_at, role DESC`,
      [conversationId, userId],
    );
    return { conversation, messages: rows.map(toMessage) };
  }

  async remove(userId: string, conversationId: string) {
    const { rows } = await this.db.query(`DELETE FROM conversations WHERE id = $2 AND user_id = $1 RETURNING id`, [userId, conversationId]);
    if (!rows.length) throw notFound("Conversation");
  }

  /** Starts a conversation with its first message. */
  async start(userId: string, text: string) {
    const title = text.trim().replace(/\s+/g, " ").slice(0, 60);
    const exchange = await this.respond(userId, null, text);
    return this.db.transaction(async (tx) => {
      const { rows } = await tx.query<{ id: string; created_at: Date; updated_at: Date }>(
        `INSERT INTO conversations (user_id, title) VALUES ($1, $2) RETURNING id, created_at, updated_at`,
        [userId, title],
      );
      const conv = rows[0]!;
      const messages = await this.saveExchange(tx, userId, conv.id, text, exchange);
      await this.timeline.add(userId, { eventType: "chat", title: "AI chat", sourceType: "user_entered", sourceId: conv.id, payload: null }, tx);
      return { conversation: { id: conv.id, title, createdAt: conv.created_at.toISOString(), updatedAt: conv.updated_at.toISOString() }, messages };
    });
  }

  async send(userId: string, conversationId: string, text: string) {
    await this.findConversation(userId, conversationId);
    const exchange = await this.respond(userId, conversationId, text);
    return this.db.transaction(async (tx) => {
      const messages = await this.saveExchange(tx, userId, conversationId, text, exchange);
      await tx.query(`UPDATE conversations SET updated_at = now() WHERE id = $1`, [conversationId]);
      return { messages };
    });
  }

  /**
   * The safety pipeline (spec §8.1): deterministic triage → (emergency: fixed
   * escalation, no model call) → context retrieval → model → response review.
   * Nothing is persisted until a response exists, so a failed AI call leaves
   * no half-written conversation.
   */
  private async respond(userId: string, conversationId: string | null, text: string): Promise<{ triage: TriageResult; payload: AssistantPayload; content: string }> {
    const result = triage(text);
    await this.recordSafetyEvent(userId, result);

    if (result.level === "emergency") {
      const escalation = escalationMessage(result)!;
      return { triage: result, payload: { kind: "escalation", escalation }, content: `${escalation.title}. ${escalation.body}` };
    }

    const history = conversationId ? await this.history(userId, conversationId) : [];
    // Retrieval: only what's relevant to this question, never the whole history.
    const { profile } = await this.profiles.get(userId);
    const today = localDay(profile.timeZone);
    const metrics = relevantMetrics(text);
    const [profileSummary, memories, daily] = await Promise.all([
      this.profiles.contextSummary(userId, new Date(), text),
      this.memories.relevant(userId, text, today),
      metrics.length ? this.healthData.daily(userId, shiftDay(today, -37), today, metrics) : Promise.resolve([]),
    ]);
    const dailyHealth = dailyHealthContext(daily, metrics, today);
    const context: AnswerContext = {
      memories: memories.map((m) => ({ id: m.id, fact: m.fact, status: m.status, temporalStatus: m.temporalStatus, occurredOn: m.occurredOn ?? null })),
      usedProfile: profileSummary.trim().length > 0,
      healthMetrics: dailyHealth.metrics,
    };
    const urgent = result.level === "urgent";
    const baseSystem = [
      CHAT_SYSTEM_PROMPT,
      contextBlock({ today, profileSummary, memorySection: renderMemoryContext(memories, today), dailyHealth: dailyHealth.lines }),
      safetyNotes({ urgentReasons: urgent ? result.matchedRules.map((r) => r.reason) : [], medicationChangeRequest: result.medicationChangeRequest }),
    ];
    const messages: AiMessage[] = [...history, { role: "user", content: text }];

    let answer: ChatAnswer;
    let safetyAdjusted = false;
    try {
      answer = (await this.ai.generate({ feature: "chat", system: baseSystem, messages, schema: ChatAnswerSchema, effort: "medium", userId })).data;
      let issues = this.review(answer);
      if (issues.length) {
        answer = (await this.ai.generate({ feature: "chat", system: [...baseSystem, REWRITE_NOTE(issues)], messages, schema: ChatAnswerSchema, effort: "medium", userId })).data;
        issues = this.review(answer);
      }
      if (issues.length) {
        safetyAdjusted = true;
        answer = { answer: SAFE_FALLBACK_ANSWER, followUp: null, warningSigns: answer.warningSigns.filter((w) => !reviewAssistantText(w).length), careRecommendation: null, memorySuggestions: [] };
      }
    } catch (error) {
      throw AiGateway.toApiError(error);
    }
    await this.memories.markUsed(userId, memories.map((m) => m.id));

    const escalation = urgent ? escalationMessage(result) : null;
    const care = urgent && (!answer.careRecommendation || !["urgent", "emergency"].includes(answer.careRecommendation.level))
      ? { level: "urgent" as const, text: escalation?.body ?? "Please contact a clinician today." }
      : answer.careRecommendation;
    return {
      triage: result,
      content: answer.answer,
      payload: {
        kind: "answer",
        answer: answer.answer,
        followUp: answer.followUp,
        warningSigns: answer.warningSigns,
        careRecommendation: care,
        memorySuggestions: answer.memorySuggestions,
        context,
        escalation,
        notice: result.medicationChangeRequest ? MEDICATION_CHANGE_NOTICE : null,
        safetyAdjusted,
      },
    };
  }

  private review(answer: ChatAnswer): string[] {
    const texts = [answer.answer, answer.careRecommendation?.text ?? "", answer.followUp?.question ?? "", ...answer.warningSigns];
    return [...new Set(texts.flatMap((t) => reviewAssistantText(t)))];
  }

  private async history(userId: string, conversationId: string): Promise<AiMessage[]> {
    const { rows } = await this.db.query<{ role: "user" | "assistant"; content: string }>(
      `SELECT role, content FROM (SELECT role, content, created_at FROM messages WHERE conversation_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT $3) recent ORDER BY created_at`,
      [conversationId, userId, HISTORY_LIMIT],
    );
    // The API requires the first message to be from the user.
    const firstUser = rows.findIndex((r) => r.role === "user");
    return (firstUser === -1 ? [] : rows.slice(firstUser)).map((r) => ({ role: r.role, content: r.content }));
  }

  private async saveExchange(tx: Queryable, userId: string, conversationId: string, text: string, exchange: { triage: TriageResult; payload: AssistantPayload; content: string }): Promise<ChatMessage[]> {
    const insert = `INSERT INTO messages (conversation_id, user_id, role, content, structured, triage_level, created_at) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7) RETURNING id, role, content, structured, triage_level, created_at`;
    const now = Date.now();
    const user = await tx.query<MessageRow>(insert, [conversationId, userId, "user", text, null, exchange.triage.level, new Date(now)]);
    const assistant = await tx.query<MessageRow>(insert, [conversationId, userId, "assistant", exchange.content, JSON.stringify(exchange.payload), exchange.triage.level, new Date(now + 1)]);
    return [toMessage(user.rows[0]!), toMessage(assistant.rows[0]!)];
  }

  private async findConversation(userId: string, id: string): Promise<Conversation> {
    const { rows } = await this.db.query<{ id: string; title: string; created_at: Date; updated_at: Date }>(
      `SELECT id, title, created_at, updated_at FROM conversations WHERE id = $2 AND user_id = $1`,
      [userId, id],
    );
    const r = rows[0];
    if (!r) throw notFound("Conversation");
    return { id: r.id, title: r.title, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString() };
  }

  /** Observability for escalations: level and rule ids only, never message text. */
  private async recordSafetyEvent(userId: string, result: TriageResult) {
    if (result.level !== "emergency" && result.level !== "urgent") return;
    await this.db
      .query(`INSERT INTO safety_events (user_id, level, rule_ids, channel) VALUES ($1, $2, $3, 'chat')`, [userId, result.level, result.matchedRules.map((r) => r.id)])
      .catch(() => undefined);
  }
}
