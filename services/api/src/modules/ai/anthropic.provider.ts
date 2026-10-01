import Anthropic from "@anthropic-ai/sdk";
import { Logger } from "@nestjs/common";
import { z } from "zod";
import { AiDeclinedError, AiInvalidOutputError, AiUnavailableError, type AiContentPart, type AiProvider, type AiProviderRequest, type AiProviderResponse, type AiUsage } from "./ai.types";

/** Turns a zod schema into the JSON Schema used for structured outputs. */
export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: "draft-2020-12" }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

type Block = Anthropic.Beta.Messages.BetaContentBlockParam;

function toBlocks(content: string | AiContentPart[]): string | Block[] {
  if (typeof content === "string") return content;
  return content.map((part): Block => {
    switch (part.type) {
      case "text":
        return { type: "text", text: part.text };
      case "pdf":
        return { type: "document", source: { type: "base64", media_type: "application/pdf", data: part.base64 } };
      case "image":
        return { type: "image", source: { type: "base64", media_type: part.mediaType, data: part.base64 } };
    }
  });
}

/**
 * Claude via the Messages API. Server-side only: the API key never leaves the
 * backend. Uses structured outputs so every response is schema-constrained,
 * and server-side refusal fallbacks (`fallbacks: "default"`). The model comes
 * from the gateway's route; the answer is validated by the gateway.
 */
export class AnthropicProvider implements AiProvider {
  readonly name = "anthropic";
  readonly available = true;
  readonly metered = true;
  private readonly client: Anthropic;
  private readonly logger = new Logger("AnthropicProvider");

  constructor(
    apiKey: string,
    readonly defaultModel: string,
    /** Tests pass a fetch stub to check the exact request sent to the Messages API. */
    options: { fetch?: typeof fetch; maxRetries?: number } = {},
  ) {
    this.client = new Anthropic({ apiKey, maxRetries: options.maxRetries ?? 1, timeout: 100_000, ...(options.fetch ? { fetch: options.fetch } : {}) });
  }

  async generate(request: AiProviderRequest): Promise<AiProviderResponse> {
    const [stable, ...dynamic] = request.system;
    const system: Anthropic.Beta.Messages.BetaTextBlockParam[] = [
      { type: "text", text: stable ?? "", cache_control: { type: "ephemeral" } },
      ...dynamic.filter(Boolean).map((text) => ({ type: "text" as const, text })),
    ];
    const params = {
      model: request.model,
      max_tokens: request.maxOutputTokens,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system,
      messages: request.messages.map((m) => ({ role: m.role, content: toBlocks(m.content) })),
      output_config: { effort: request.effort, format: { type: "json_schema", schema: toJsonSchema(request.schema) } },
    } as unknown as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

    let response: Anthropic.Beta.Messages.BetaMessage;
    try {
      response = await this.client.beta.messages.create(params);
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        // Status only — never log prompts or health content.
        this.logger.warn(`Anthropic API error ${error.status ?? "network"} for ${request.task}`);
      }
      // An HTTP error status means the request wasn't processed (not billed). A dropped or
      // timed-out connection may have been processed: the gateway charges the reservation.
      const usageUnknown = error instanceof Anthropic.APIConnectionError || !(error instanceof Anthropic.APIError);
      throw new AiUnavailableError(undefined, { usageUnknown });
    }

    const billed = { model: response.model, usage: usageOf(response.usage), usageByModel: usageByModel(response.usage, request.model) };
    if (response.stop_reason === "refusal") {
      // The whole fallback chain declined. Category only — never content. Refusals are billed.
      this.logger.warn(`Model declined ${request.task} (${(response as { stop_details?: { category?: string | null } }).stop_details?.category ?? "no category"})`);
      throw new AiDeclinedError(billed);
    }
    // A cut-off answer can't be valid JSON; say so rather than guessing (its tokens are billed).
    if (response.stop_reason === "max_tokens") throw new AiInvalidOutputError(billed);
    const text = response.content
      .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new AiInvalidOutputError(billed);
    }
    return { data, ...billed };
  }
}

type ApiUsage = Partial<Anthropic.Beta.Messages.BetaUsage> | null | undefined;

/** Total usage as reported; undefined when the response carries none (the gateway then charges the reservation). */
function usageOf(usage: ApiUsage): AiUsage | undefined {
  if (!usage || typeof usage.input_tokens !== "number" || typeof usage.output_tokens !== "number") return undefined;
  return { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, cacheReadTokens: usage.cache_read_input_tokens ?? 0, cacheWriteTokens: usage.cache_creation_input_tokens ?? 0 };
}

/**
 * Per-model usage from `usage.iterations` when a refusal fallback ran (each
 * model's share is billed at its own price). undefined when only one model ran.
 */
function usageByModel(usage: ApiUsage, requestedModel: string): { model: string; usage: AiUsage }[] | undefined {
  const iterations = (usage as { iterations?: unknown } | null | undefined)?.iterations;
  if (!Array.isArray(iterations) || iterations.length === 0) return undefined;
  const entries = iterations
    .filter((it): it is { type: string; model?: string | null; input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } =>
      Boolean(it) && typeof it === "object" && (it.type === "message" || it.type === "fallback_message") && typeof it.input_tokens === "number" && typeof it.output_tokens === "number")
    .map((it) => ({
      model: it.model ?? requestedModel,
      usage: { inputTokens: it.input_tokens, outputTokens: it.output_tokens, cacheReadTokens: it.cache_read_input_tokens ?? 0, cacheWriteTokens: it.cache_creation_input_tokens ?? 0 },
    }));
  return entries.length > 1 || entries.some((e) => e.model !== requestedModel) ? entries : undefined;
}

/** Used when no provider is configured: AI features fail clearly instead of fabricating. */
export class UnavailableProvider implements AiProvider {
  readonly name = "unavailable";
  readonly available = false;
  readonly metered = false;
  readonly defaultModel = "none";
  async generate(): Promise<AiProviderResponse> {
    throw new AiUnavailableError("No AI provider is configured on this server.");
  }
}
