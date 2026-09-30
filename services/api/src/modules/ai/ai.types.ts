import type { ZodType } from "zod";

/**
 * What the AI is being asked to do. The gateway routes each task to a
 * provider and model (config `AI_ROUTES`), prices it and validates the answer.
 */
export const AI_TASKS = ["health_chat", "complex_health", "report_analysis", "image_analysis", "task_generation", "summarization"] as const;
export type AiTask = (typeof AI_TASKS)[number];

export type AiEffort = "low" | "medium" | "high";

export type AiContentPart =
  | { type: "text"; text: string }
  | { type: "pdf"; base64: string }
  | { type: "image"; mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp"; base64: string };

export interface AiMessage {
  role: "user" | "assistant";
  content: string | AiContentPart[];
}

/** What a feature asks the gateway for. Features never talk to a provider. */
export interface AiTaskRequest<T> {
  task: AiTask;
  /** Owner of the request, for accounting and the monthly cost limit. null: system work. */
  userId: string | null;
  /** Stable instructions first (cached by providers that support it), then per-request context. */
  system: string[];
  messages: AiMessage[];
  /** The response must validate against this schema. */
  schema: ZodType<T>;
  /** Overrides the route's effort for this request. */
  effort?: AiEffort;
  /**
   * Safety-relevant answers (urgent symptoms) are never refused by the cost
   * limit. Emergencies don't reach the gateway at all: they're answered
   * deterministically before any model call.
   */
  safetyCritical?: boolean;
}

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface AiTaskResult<T> {
  data: T;
  /** Content problems found after generation (e.g. "diagnosis", "dose"). Callers decide what to do. */
  issues: string[];
  provider: string;
  model: string;
  usage: AiUsage;
  /** Priced from the reported token usage (USD). */
  costUsd: number;
}

/** What the gateway sends a provider: the task, the routed model and generation settings. */
export interface AiProviderRequest {
  task: AiTask;
  model: string;
  system: string[];
  messages: AiMessage[];
  /** For structured output. Validation of the answer is the gateway's job. */
  schema: ZodType<unknown>;
  effort: AiEffort;
  maxOutputTokens: number;
}

export interface AiProviderResponse {
  /** Parsed JSON, not yet validated. */
  data: unknown;
  /** The model that actually answered (may differ after a provider-side fallback). */
  model: string;
  usage: AiUsage;
  /** Only when the provider reports a billed amount itself (USD). */
  actualCostUsd?: number;
}

/**
 * An AI backend (Anthropic today; Gemini/OpenAI can be added by implementing
 * this). Providers only generate: routing, cost limits, accounting and
 * validation live in `AiGateway`. API keys stay inside the provider, server-side.
 */
export interface AiProvider {
  readonly name: string;
  readonly available: boolean;
  /** Scripted answers, not a real model. Clients must show a demo notice. */
  readonly demo?: boolean;
  /** Used when a route doesn't name a model. */
  readonly defaultModel: string;
  generate(request: AiProviderRequest): Promise<AiProviderResponse>;
}

/** No provider configured, or the provider failed. The product must say so, never improvise. */
export class AiUnavailableError extends Error {
  constructor(message = "The AI service is unavailable.") {
    super(message);
    this.name = "AiUnavailableError";
  }
}

/** The model declined the request (safety refusal after fallbacks). */
export class AiDeclinedError extends Error {
  constructor() {
    super("The AI declined this request.");
    this.name = "AiDeclinedError";
  }
}

/** The model's output did not match the required schema. */
export class AiInvalidOutputError extends Error {
  constructor() {
    super("The AI returned an unusable response.");
    this.name = "AiInvalidOutputError";
  }
}

/** The person's internal monthly AI cost limit is reached. Never shown to them as a balance. */
export class AiBudgetExceededError extends Error {
  constructor() {
    super("The monthly AI cost limit is reached.");
    this.name = "AiBudgetExceededError";
  }
}

/** Every configured provider, by name. The first is the default route. */
export const AI_PROVIDERS = Symbol("AI_PROVIDERS");
