import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { AnthropicProvider } from "../src/modules/ai/anthropic.provider";
import { AiDeclinedError, AiInvalidOutputError, AiUnavailableError } from "../src/modules/ai/ai.types";
import { CHAT_SYSTEM_PROMPT, ChatAnswerSchema, contextBlock } from "../src/modules/chat/chat.prompts";
import { chatAnswer } from "./helpers";

/**
 * The real Anthropic SDK code path, against a stubbed HTTP endpoint (no
 * network, no API key): checks exactly what HealthMate sends to Claude and how
 * it handles each kind of response.
 */
type Captured = { url: string; headers: Record<string, string>; body: Record<string, unknown> };
function stub(respond: () => { status?: number; body: unknown }) {
  const calls: Captured[] = [];
  const fetchImpl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => (headers[k] = v));
    calls.push({ url: String(input), headers, body: JSON.parse(String(init.body)) });
    const { status = 200, body } = respond();
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const message = (text: string, extra: Record<string, unknown> = {}) => ({
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "claude-opus-5-5",
  content: [{ type: "text", text }],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 1200, output_tokens: 180 },
  ...extra,
});

const request = {
  feature: "chat" as const,
  system: [CHAT_SYSTEM_PROMPT, contextBlock({ today: "2026-09-30", profileSummary: "", memorySection: "Current:\n- none relevant", dailyHealth: [] })],
  messages: [{ role: "user" as const, content: "I have a headache" }],
  schema: ChatAnswerSchema,
  effort: "medium" as const,
};

describe("Anthropic provider (real SDK, stubbed HTTP)", () => {
  it("defaults to Claude Opus 5.5", () => {
    expect(loadConfig({ NODE_ENV: "test" } as NodeJS.ProcessEnv).AI_MODEL).toBe("claude-opus-5-5");
  });

  it("sends a cached system prompt, the context as data, a JSON schema and refusal fallbacks", async () => {
    const { fetchImpl, calls } = stub(() => ({ body: message(JSON.stringify(chatAnswer())) }));
    const provider = new AnthropicProvider("sk-test-not-real", "claude-opus-5-5", { fetch: fetchImpl, maxRetries: 0 });
    const result = await provider.generate(request);
    expect(result.data.answer).toContain("headache");
    expect(result.usage).toEqual({ inputTokens: 1200, outputTokens: 180 });

    const { url, headers, body } = calls[0]!;
    expect(url).toMatch(/\/v1\/messages(\?beta=true)?$/);
    expect(headers["x-api-key"]).toBe("sk-test-not-real");
    expect(headers["anthropic-beta"]).toContain("server-side-fallback-2026-07-01");
    expect(body.model).toBe("claude-opus-5-5");
    expect(body.fallbacks).toBe("default");
    expect(body).not.toHaveProperty("thinking"); // adaptive by default on this model; never "disabled"
    expect(body).not.toHaveProperty("tool_choice");
    const system = body.system as { text: string; cache_control?: unknown }[];
    expect(system[0]).toMatchObject({ text: CHAT_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }); // stable prefix cached
    expect(system[1]!.text).toContain("<health_context>");
    expect(system[1]).not.toHaveProperty("cache_control"); // per-request context after the breakpoint
    const output = body.output_config as { effort: string; format: { type: string; schema: { properties: Record<string, unknown> } } };
    expect(output.effort).toBe("medium");
    expect(output.format.type).toBe("json_schema");
    expect(Object.keys(output.format.schema.properties)).toEqual(expect.arrayContaining(["answer", "followUp", "warningSigns", "careRecommendation", "memorySuggestions"]));
    expect(body.messages).toEqual([{ role: "user", content: "I have a headache" }]);
  });

  it("treats a refusal, a cut-off answer, invalid JSON and API errors honestly", async () => {
    const declined = new AnthropicProvider("k", "claude-opus-5-5", { fetch: stub(() => ({ body: message("", { content: [], stop_reason: "refusal", stop_details: { type: "refusal", category: "bio", explanation: null } }) })).fetchImpl, maxRetries: 0 });
    await expect(declined.generate(request)).rejects.toBeInstanceOf(AiDeclinedError);
    const cut = new AnthropicProvider("k", "claude-opus-5-5", { fetch: stub(() => ({ body: message('{"answer": "par', { stop_reason: "max_tokens" }) })).fetchImpl, maxRetries: 0 });
    await expect(cut.generate(request)).rejects.toBeInstanceOf(AiInvalidOutputError);
    const garbled = new AnthropicProvider("k", "claude-opus-5-5", { fetch: stub(() => ({ body: message(JSON.stringify({ answer: 5 })) })).fetchImpl, maxRetries: 0 });
    await expect(garbled.generate(request)).rejects.toBeInstanceOf(AiInvalidOutputError);
    const down = new AnthropicProvider("k", "claude-opus-5-5", { fetch: stub(() => ({ status: 529, body: { type: "error", error: { type: "overloaded_error", message: "Overloaded" } } })).fetchImpl, maxRetries: 0 });
    await expect(down.generate(request)).rejects.toBeInstanceOf(AiUnavailableError);
  });

  it("sends reports and photos as document and image blocks", async () => {
    const { fetchImpl, calls } = stub(() => ({ body: message(JSON.stringify(chatAnswer())) }));
    const provider = new AnthropicProvider("k", "claude-opus-5-5", { fetch: fetchImpl, maxRetries: 0 });
    await provider.generate({
      ...request,
      messages: [{ role: "user", content: [{ type: "pdf", base64: "JVBERi0x" }, { type: "image", mediaType: "image/png", base64: "iVBORw0" }, { type: "text", text: "Explain this" }] }],
    });
    const content = (calls[0]!.body.messages as { content: { type: string; source?: { media_type: string } }[] }[])[0]!.content;
    expect(content.map((c) => `${c.type}:${c.source?.media_type ?? ""}`)).toEqual(["document:application/pdf", "image:image/png", "text:"]);
  });
});
