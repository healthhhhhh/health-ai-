import type { ZodType } from "zod";

export type AiFeature = "chat" | "document_extraction" | "image_analysis";

export type AiContentPart =
  | { type: "text"; text: string }
  | { type: "pdf"; base64: string }
  | { type: "image"; mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp"; base64: string };

export interface AiMessage {
  role: "user" | "assistant";
  content: string | AiContentPart[];
}

export interface AiRequest<T> {
  feature: AiFeature;
  /** Stable instructions first (cached), then per-request context. */
  system: string[];
  messages: AiMessage[];
  /** The response must validate against this schema. */
  schema: ZodType<T>;
  effort?: "low" | "medium" | "high";
  userId?: string;
}

export interface AiResult<T> {
  data: T;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface AiProvider {
  readonly name: string;
  readonly available: boolean;
  /** Scripted demo answers, not a real model. Clients must show a demo notice. */
  readonly demo?: boolean;
  generate<T>(request: AiRequest<T>): Promise<AiResult<T>>;
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

export const AI_PROVIDER = Symbol("AI_PROVIDER");
