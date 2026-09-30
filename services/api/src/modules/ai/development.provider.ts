import type { AiProviderRequest, AiProviderResponse } from "./ai.types";
import { DemoAiProvider } from "./demo.provider";

/**
 * Offline provider for local development (`AI_PROVIDER=development`): no API
 * key, no network, no cost. It is not a model and never interprets anything —
 * the chat answer says so and lists, verbatim, the health context that
 * retrieval selected for the question, so memory recall, exclusion, past
 * facts and daily-data context can be checked without a paid AI provider.
 * Documents and photos are reported as not analysed (as in the demo).
 * Clients show their demo notice because `demo` is true. Refused in production.
 */
export class DevelopmentAiProvider extends DemoAiProvider {
  override readonly name: string = "development";
  override readonly defaultModel: string = "development-offline";

  override async generate(request: AiProviderRequest): Promise<AiProviderResponse> {
    if (request.task !== "health_chat" && request.task !== "complex_health") return super.generate(request);
    const data = { answer: developmentAnswer(request.system), followUp: null, warningSigns: [], careRecommendation: null, memorySuggestions: [] };
    return { data, model: this.defaultModel, usage: { inputTokens: 0, outputTokens: 0 } };
  }
}

const NOTICE = "Development mode: no AI model was called. This is a scripted answer, not a real AI answer and not medical advice.";

/** The answer text: the notice, then the selected context exactly as it would be sent to a model. */
export function developmentAnswer(system: string[]): string {
  const { memories, daily } = selectedContext(system);
  const parts = [NOTICE];
  if (memories.length) parts.push(`From your health memory, HealthMate selected for this question:\n${memories.join("\n")}`);
  else parts.push("No facts from your health memory were selected for this question.");
  if (daily.length) parts.push(`Daily health data selected:\n${daily.join("\n")}`);
  parts.push("With a real AI provider configured, the AI Health Assistant would answer using this context.");
  return parts.join("\n\n");
}

/** Pulls the retrieved memory and daily-data lines out of the <health_context> block. */
export function selectedContext(system: string[]): { memories: string[]; daily: string[] } {
  const block = system.find((part) => part.startsWith("<health_context>")) ?? "";
  const lines = block.split("\n");
  const historyStart = lines.findIndex((l) => l.startsWith("Previous relevant history"));
  const dailyStart = lines.findIndex((l) => l.startsWith("Daily health data relevant"));
  const end = lines.findIndex((l) => l.startsWith("</health_context>"));
  if (historyStart === -1 || dailyStart === -1) return { memories: [], daily: [] };
  const history = lines.slice(historyStart + 1, dailyStart);
  // Drop "none relevant" placeholders and the headings they stand under.
  const memories = history.filter((l, i) => l !== "- none relevant" && history[i + 1] !== "- none relevant");
  return { memories: memories.some((l) => l.startsWith("- ")) ? memories : [], daily: daily(lines, dailyStart, end) };
}

const daily = (lines: string[], start: number, end: number) =>
  lines.slice(start + 1, end === -1 ? undefined : end).filter((l) => l.startsWith("- ") && l !== "- none relevant");
