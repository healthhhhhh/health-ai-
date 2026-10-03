import { BedrockRuntimeClient, ConverseCommand, type BedrockRuntimeClientConfig, type ContentBlock, type ConverseCommandOutput, type Message, type TokenUsage } from "@aws-sdk/client-bedrock-runtime";
import { Logger } from "@nestjs/common";
import { toJsonSchema } from "./anthropic.provider";
import { AiDeclinedError, AiInvalidOutputError, AiUnavailableError, type AiContentPart, type AiProvider, type AiProviderRequest, type AiProviderResponse, type AiUsage } from "./ai.types";

/** The forced tool that carries the structured answer (Converse has no provider-neutral JSON mode). */
const ANSWER_TOOL = "respond";

export interface BedrockProviderOptions {
  /** Bedrock API key (`AWS_BEARER_TOKEN_BEDROCK`). Sent as a bearer token; never logged. */
  apiKey: string;
  /** `AWS_REGION`: where the model is invoked (the model must be available there to this account). */
  region: string;
  /** `BEDROCK_MODEL_ID`: model ID, inference profile ID or ARN; the default for every task. */
  modelId: string;
  /** Tests pass a fake HTTP handler so no request leaves the process. */
  requestHandler?: BedrockRuntimeClientConfig["requestHandler"];
  maxAttempts?: number;
}

/** Why a request failed, for the server log (names only — never prompts, answers or the key). */
const HINTS: Record<string, string> = {
  AccessDeniedException: "check AWS_BEARER_TOKEN_BEDROCK and that this account has access to the model in AWS_REGION",
  UnrecognizedClientException: "the Bedrock API key wasn't accepted (check AWS_BEARER_TOKEN_BEDROCK)",
  ResourceNotFoundException: "BEDROCK_MODEL_ID wasn't found in AWS_REGION",
  ValidationException: "the request or BEDROCK_MODEL_ID isn't valid for this model (some models need an inference profile ID)",
  ThrottlingException: "Bedrock throttled the request (quota)",
  ServiceQuotaExceededException: "Bedrock quota exceeded",
  ModelNotReadyException: "the model isn't ready",
  ModelTimeoutException: "the model timed out",
  ServiceUnavailableException: "Bedrock is unavailable",
  InternalServerException: "Bedrock internal error",
  ModelErrorException: "the model returned an error",
};

/**
 * Amazon Bedrock through the Converse API, as one more `AiProvider` behind the
 * gateway (routing, consent, cost limits, accounting and validation stay in
 * `AiGateway`). For development testing: production refuses it (config.ts).
 *
 * - Auth: the Bedrock API key as a bearer token, passed explicitly from
 *   configuration (never read implicitly, never sent to clients).
 * - Structured output: one forced tool whose input schema is the task's JSON
 *   schema; the tool input is the answer. The gateway validates it.
 * - Usage: the token counts Bedrock reports. No Bedrock price is built in —
 *   the model must have an `AI_PRICES` entry or the gateway refuses it.
 * - `effort` has no Converse equivalent and isn't sent.
 */
export class BedrockProvider implements AiProvider {
  readonly name = "bedrock";
  readonly available = true;
  readonly metered = true;
  readonly defaultModel: string;
  private readonly client: BedrockRuntimeClient;
  private readonly logger = new Logger("BedrockProvider");

  constructor(options: BedrockProviderOptions) {
    this.defaultModel = options.modelId;
    this.client = new BedrockRuntimeClient({
      region: options.region,
      token: { token: options.apiKey },
      authSchemePreference: ["httpBearerAuth"],
      maxAttempts: options.maxAttempts ?? 2,
      requestHandler: options.requestHandler ?? { requestTimeout: 100_000 },
    });
  }

  async generate(request: AiProviderRequest): Promise<AiProviderResponse> {
    let response: ConverseCommandOutput;
    try {
      response = await this.client.send(
        new ConverseCommand({
          modelId: request.model,
          system: request.system.filter(Boolean).map((text) => ({ text })),
          messages: request.messages.map((m): Message => ({ role: m.role, content: toBlocks(m.content) })),
          inferenceConfig: { maxTokens: request.maxOutputTokens },
          toolConfig: {
            tools: [{ toolSpec: { name: ANSWER_TOOL, description: "Return the answer in the required format.", inputSchema: { json: toJsonSchema(request.schema) as never } } }],
            toolChoice: { tool: { name: ANSWER_TOOL } },
          },
        }),
      );
    } catch (error) {
      const name = error instanceof Error ? error.name : "error";
      const status = (error as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata?.httpStatusCode;
      // Error name and status only — never prompts, health content or the key.
      this.logger.warn(`Bedrock ${name}${status ? ` ${status}` : ""} for ${request.task}${HINTS[name] ? `: ${HINTS[name]}` : ""}`);
      // A refused request (4xx other than a timeout) wasn't processed. A timeout, a server error
      // or a dropped connection may have been: the gateway then charges the reservation.
      const usageUnknown = status === undefined || status === 408 || status >= 500 || name === "ModelTimeoutException";
      throw new AiUnavailableError(undefined, { usageUnknown });
    }

    const billed = { model: request.model, usage: usageOf(response.usage) };
    // Blocked by a guardrail or content filter: declined (still billed).
    if (response.stopReason === "guardrail_intervened" || response.stopReason === "content_filtered") {
      this.logger.warn(`Bedrock declined ${request.task} (${response.stopReason})`);
      throw new AiDeclinedError(billed);
    }
    // A cut-off answer can't be trusted (its tokens are billed).
    if (response.stopReason === "max_tokens" || response.stopReason === "model_context_window_exceeded") throw new AiInvalidOutputError(billed);

    const content = response.output && "message" in response.output ? (response.output.message?.content ?? []) : [];
    const tool = content.find((b) => b.toolUse?.name === ANSWER_TOOL)?.toolUse;
    if (tool) return { data: tool.input, ...billed };
    // Some models answer in text despite the forced tool: accept it only if it's JSON.
    const text = content.map((b) => b.text ?? "").join("");
    try {
      return { data: JSON.parse(text), ...billed };
    } catch {
      throw new AiInvalidOutputError(billed);
    }
  }
}

function toBlocks(content: string | AiContentPart[]): ContentBlock[] {
  if (typeof content === "string") return [{ text: content }];
  return content.map((part, index): ContentBlock => {
    switch (part.type) {
      case "text":
        return { text: part.text };
      case "pdf":
        // Converse requires a document name; it must not carry personal details.
        return { document: { format: "pdf", name: `document-${index + 1}`, source: { bytes: Buffer.from(part.base64, "base64") } } };
      case "image":
        return { image: { format: part.mediaType.slice("image/".length) as "jpeg" | "png" | "gif" | "webp", source: { bytes: Buffer.from(part.base64, "base64") } } };
    }
  });
}

/** Usage as reported; undefined when missing (the gateway then charges the reservation). */
function usageOf(usage: TokenUsage | undefined): AiUsage | undefined {
  if (!usage || typeof usage.inputTokens !== "number" || typeof usage.outputTokens !== "number") return undefined;
  return { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cacheReadTokens: usage.cacheReadInputTokens ?? 0, cacheWriteTokens: usage.cacheWriteInputTokens ?? 0 };
}
