import Anthropic from "@anthropic-ai/sdk";
import { Logger } from "@nestjs/common";
import { z } from "zod";
import { AiDeclinedError, AiInvalidOutputError, AiUnavailableError, type AiContentPart, type AiProvider, type AiProviderRequest, type AiProviderResponse } from "./ai.types";

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
  private readonly client: Anthropic;
  private readonly logger = new Logger("AnthropicProvider");

  constructor(
    apiKey: string,
    readonly defaultModel: string,
    /** Tests pass a fetch stub to check the exact request sent to the Messages API. */
    options: { fetch?: typeof fetch; maxRetries?: number } = {},
  ) {
    this.client = new Anthropic({ apiKey, maxRetries: options.maxRetries ?? 2, timeout: 120_000, ...(options.fetch ? { fetch: options.fetch } : {}) });
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
      throw new AiUnavailableError();
    }

    if (response.stop_reason === "refusal") {
      // The whole fallback chain declined. Category only — never content.
      this.logger.warn(`Model declined ${request.task} (${(response as { stop_details?: { category?: string | null } }).stop_details?.category ?? "no category"})`);
      throw new AiDeclinedError();
    }
    // A cut-off answer can't be valid JSON; say so rather than guessing.
    if (response.stop_reason === "max_tokens") throw new AiInvalidOutputError();
    const text = response.content
      .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new AiInvalidOutputError();
    }
    return {
      data,
      model: response.model,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
      },
    };
  }
}

/** Used when no provider is configured: AI features fail clearly instead of fabricating. */
export class UnavailableProvider implements AiProvider {
  readonly name = "unavailable";
  readonly available = false;
  readonly defaultModel = "none";
  async generate(): Promise<AiProviderResponse> {
    throw new AiUnavailableError("No AI provider is configured on this server.");
  }
}
