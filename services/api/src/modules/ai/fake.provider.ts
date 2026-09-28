import { AiUnavailableError, type AiProvider, type AiRequest, type AiResult } from "./ai.types";

type Handler = (request: AiRequest<unknown>) => unknown;

/**
 * Test double. Each call is answered by the handler registered for its
 * feature; the answer still goes through the request's schema, exactly like
 * real provider output. Records requests so tests can assert on prompts.
 */
export class FakeAiProvider implements AiProvider {
  readonly name = "fake";
  available = true;
  readonly requests: AiRequest<unknown>[] = [];
  private readonly handlers = new Map<string, Handler>();

  on(feature: AiRequest<unknown>["feature"], handler: Handler) {
    this.handlers.set(feature, handler);
    return this;
  }

  async generate<T>(request: AiRequest<T>): Promise<AiResult<T>> {
    this.requests.push(request as AiRequest<unknown>);
    const handler = this.handlers.get(request.feature);
    if (!this.available || !handler) throw new AiUnavailableError();
    const data = request.schema.parse(handler(request as AiRequest<unknown>));
    return { data, model: "fake-model", usage: { inputTokens: 10, outputTokens: 20 } };
  }
}
