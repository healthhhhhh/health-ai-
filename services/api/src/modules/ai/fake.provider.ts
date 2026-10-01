import { AiUnavailableError, type AiProvider, type AiProviderRequest, type AiProviderResponse, type AiTask, type AiUsage } from "./ai.types";

type Handler = (request: AiProviderRequest) => unknown;

/**
 * Test double. Each call is answered by the handler registered for its task
 * ("chat" registers both chat tasks). Answers are returned unvalidated, like
 * real provider output, so the gateway's validation is exercised. Records
 * requests so tests can assert on prompts and routing.
 */
export class FakeAiProvider implements AiProvider {
  readonly name: string;
  readonly defaultModel: string;
  readonly metered: boolean;
  available = true;
  /** undefined: the response carries no usage metadata. */
  usage: AiUsage | undefined;
  /** Delay before answering (ms), for timeout tests. */
  delayMs = 0;
  /** Thrown instead of answering, when set. */
  failWith: Error | null = null;
  readonly requests: AiProviderRequest[] = [];
  private readonly handlers = new Map<AiTask, Handler>();

  constructor(options: { name?: string; model?: string; usage?: AiUsage | null; metered?: boolean } = {}) {
    this.name = options.name ?? "fake";
    this.defaultModel = options.model ?? "fake-model";
    this.metered = options.metered ?? false;
    this.usage = options.usage === null ? undefined : (options.usage ?? { inputTokens: 10, outputTokens: 20 });
  }

  on(task: AiTask | "chat", handler: Handler) {
    for (const t of task === "chat" ? (["health_chat", "complex_health"] as const) : [task]) this.handlers.set(t, handler);
    return this;
  }

  async generate(request: AiProviderRequest): Promise<AiProviderResponse> {
    this.requests.push(request);
    if (this.delayMs) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    if (this.failWith) throw this.failWith;
    const handler = this.handlers.get(request.task);
    if (!this.available || !handler) throw new AiUnavailableError();
    return { data: handler(request), model: request.model, usage: this.usage };
  }
}
