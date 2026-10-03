import { Logger } from "@nestjs/common";
import { toJsonSchema } from "./anthropic.provider";
import { isFreeOpenRouterModel } from "./ai.routing";
import { AiDeclinedError, AiInvalidOutputError, AiUnavailableError, type AiContentPart, type AiProvider, type AiProviderRequest, type AiProviderResponse, type AiUsage } from "./ai.types";


export interface OpenRouterProviderOptions {
  /** `OPENROUTER_API_KEY`: sent as a bearer token; never logged. */
  apiKey: string;
  /** `OPENROUTER_MODEL`, e.g. "openrouter/free". */
  model: string;
  /** Paid models only with `OPENROUTER_ALLOW_PAID=true` (config.ts also checks this at startup). */
  allowPaid: boolean;
  baseUrl?: string;
  /** Tests pass a fetch stub so nothing leaves the process. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** Why a request failed, for the server log (status only — never prompts, answers or the key). */
const HINTS: Record<number, string> = {
  400: "OpenRouter rejected the request (the chosen model may not support JSON output, images or files)",
  401: "OPENROUTER_API_KEY wasn't accepted",
  402: "the OpenRouter account has no credits for this model (free models shouldn't need any)",
  403: "refused — by OpenRouter (moderation, or the account's privacy settings for free models) or by a network policy blocking openrouter.ai",
  404: "OPENROUTER_MODEL wasn't found, or no endpoint matches the request",
  408: "the model timed out",
  429: "rate limited (free models have per-minute and per-day limits)",
  502: "the model's provider failed",
  503: "no provider is available for this model right now",
};

type ChatMessage = { role: "system" | "user" | "assistant"; content: string | Record<string, unknown>[] };
interface ChatCompletion {
  model?: string;
  choices?: { finish_reason?: string | null; native_finish_reason?: string | null; message?: { content?: string | null; refusal?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number; prompt_tokens_details?: { cached_tokens?: number } };
  error?: { code?: number; message?: string };
}

/**
 * OpenRouter through its OpenAI-compatible Chat Completions API, as one more
 * `AiProvider` behind the gateway (routing, consent, cost limits, accounting and
 * validation stay in `AiGateway`). For development testing: production refuses it
 * (config.ts), because free models may log or train on what they receive.
 *
 * - Free models only unless paid ones are explicitly allowed (checked here and at startup).
 * - Structured output via `response_format: json_schema`; the gateway validates the answer.
 * - Images as data-URL `image_url` parts. PDFs as `file` parts with OpenRouter's
 *   `file-parser` plugin (text extraction), since many models can't read PDFs natively.
 * - Usage and the billed cost (`usage.cost`) as OpenRouter reports them.
 */
export class OpenRouterProvider implements AiProvider {
  readonly name = "openrouter";
  readonly available = true;
  /** Free-only use costs nothing; paid use is metered and needs AI_PRICES (fail closed). */
  readonly metered: boolean;
  readonly defaultModel: string;
  private readonly logger = new Logger("OpenRouterProvider");
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(private readonly options: OpenRouterProviderOptions) {
    this.defaultModel = options.model;
    this.metered = options.allowPaid;
    this.fetchImpl = options.fetch ?? fetch;
    this.baseUrl = (options.baseUrl ?? "https://openrouter.ai/api/v1").replace(/\/$/, "");
  }

  async generate(request: AiProviderRequest): Promise<AiProviderResponse> {
    if (!this.options.allowPaid && !isFreeOpenRouterModel(request.model)) {
      // Never send a request that could bill without explicit permission.
      this.logger.warn(`refused ${request.task}: model isn't free and OPENROUTER_ALLOW_PAID isn't set`);
      throw new AiUnavailableError("Only free OpenRouter models are allowed.");
    }
    const hasPdf = request.messages.some((m) => typeof m.content !== "string" && m.content.some((p) => p.type === "pdf"));
    const messages: ChatMessage[] = [
      { role: "system", content: request.system.filter(Boolean).join("\n\n") },
      ...request.messages.map((m): ChatMessage => ({ role: m.role, content: toParts(m.content) })),
    ];
    const body = {
      model: request.model,
      messages,
      max_tokens: request.maxOutputTokens,
      response_format: { type: "json_schema", json_schema: { name: "healthmate_answer", strict: true, schema: toJsonSchema(request.schema) } },
      // Report the billed amount with the usage.
      usage: { include: true },
      ...(hasPdf ? { plugins: [{ id: "file-parser", pdf: { engine: "pdf-text" } }] } : {}),
    };

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.options.apiKey}`, "Content-Type": "application/json", "X-Title": "HealthMate (development)" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 100_000),
      });
    } catch (error) {
      // No answer: the request may still have been processed, so the gateway charges the reservation.
      this.logger.warn(`OpenRouter ${error instanceof Error ? error.name : "network error"} for ${request.task}`);
      throw new AiUnavailableError(undefined, { usageUnknown: true });
    }

    const json = (await res.json().catch(() => null)) as ChatCompletion | null;
    if (!res.ok || !json || json.error) {
      const status = res.ok ? (json?.error?.code ?? 502) : res.status;
      this.logger.warn(`OpenRouter ${status} for ${request.task}${HINTS[status] ? `: ${HINTS[status]}` : ""}`);
      throw new AiUnavailableError(undefined, { usageUnknown: status === 408 || status >= 500 });
    }

    const model = json.model ?? request.model;
    const usage = usageOf(json.usage);
    const actualCostUsd = typeof json.usage?.cost === "number" && Number.isFinite(json.usage.cost) && json.usage.cost >= 0 ? json.usage.cost : undefined;
    if (actualCostUsd && actualCostUsd > 0 && !this.options.allowPaid) this.logger.error(`OpenRouter billed $${actualCostUsd} for ${request.task} although only free models are allowed`);
    const billed = { model, usage, ...(actualCostUsd !== undefined ? { actualCostUsd } : {}) };
    const choice = json.choices?.[0];
    if (choice?.message?.refusal || choice?.finish_reason === "content_filter") {
      this.logger.warn(`Model declined ${request.task}`);
      throw new AiDeclinedError(billed);
    }
    if (choice?.finish_reason === "length") throw new AiInvalidOutputError(billed);
    try {
      return { data: JSON.parse(stripFences(choice?.message?.content ?? "")), ...billed };
    } catch {
      throw new AiInvalidOutputError(billed);
    }
  }
}

function toParts(content: string | AiContentPart[]): string | Record<string, unknown>[] {
  if (typeof content === "string") return content;
  return content.map((part, index) => {
    switch (part.type) {
      case "text":
        return { type: "text", text: part.text };
      case "image":
        return { type: "image_url", image_url: { url: `data:${part.mediaType};base64,${part.base64}` } };
      case "pdf":
        // A neutral file name: it must not carry personal details.
        return { type: "file", file: { filename: `document-${index + 1}.pdf`, file_data: `data:application/pdf;base64,${part.base64}` } };
    }
  });
}

/** Some models wrap JSON in a Markdown code fence despite the JSON mode. */
function stripFences(text: string): string {
  const fenced = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i.exec(text);
  return fenced ? fenced[1]! : text;
}

/** Usage as reported; undefined when missing (the gateway then charges the reservation, if metered). */
function usageOf(usage: ChatCompletion["usage"]): AiUsage | undefined {
  if (!usage || typeof usage.prompt_tokens !== "number" || typeof usage.completion_tokens !== "number") return undefined;
  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
  return { inputTokens: Math.max(0, usage.prompt_tokens - cached), outputTokens: usage.completion_tokens, cacheReadTokens: cached, cacheWriteTokens: 0 };
}
