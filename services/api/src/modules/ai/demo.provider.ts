import type { AiProvider, AiProviderRequest, AiProviderResponse, AiTask } from "./ai.types";

/**
 * Scripted provider for demos and screenshots (`npm run demo -w @healthmate/api`).
 * It never pretends to analyse anything: every answer says it is a demo,
 * gives only general, widely published wellbeing information, and documents
 * and photos are reported as not analysed. Output still passes through the
 * request schema and the normal safety pipeline.
 */
export class DemoAiProvider implements AiProvider {
  readonly name: string = "demo";
  readonly available = true;
  readonly demo = true;
  readonly defaultModel: string = "demo-script";

  async generate(request: AiProviderRequest): Promise<AiProviderResponse> {
    return { data: this.answer(request.task), model: this.defaultModel, usage: { inputTokens: 0, outputTokens: 0 } };
  }

  protected answer(task: AiTask): unknown {
    switch (task) {
      case "health_chat":
      case "complex_health":
        return {
          answer:
            "Demo mode: this is a scripted example, not a real AI answer. In the full app I'd ask about what's going on and explain things in plain language. General tips many people find helpful for sleep: keep a regular bedtime, get daylight in the morning, and avoid screens and caffeine late in the day.",
          followUp: { question: "How many hours do you usually sleep?", options: ["Under 6", "6 to 8", "Over 8"], allowsMultiple: false },
          warningSigns: ["Loud snoring with pauses in breathing", "Feeling very sleepy while driving"],
          careRecommendation: { level: "routine", text: "If poor sleep lasts more than a few weeks, talk to a doctor." },
          memorySuggestions: [],
        };
      case "report_analysis":
        return {
          readable: false,
          documentType: "other",
          summary: "Demo mode: documents aren't analysed. Connect a real AI provider to read reports.",
          findings: [],
          suggestedQuestions: [],
          containsInstructionsToAi: false,
        };
      case "image_analysis":
        return {
          quality: "poor",
          qualityIssue: "Demo mode: photos aren't analysed. Connect a real AI provider to check photos.",
          supported: true,
          bodyArea: null,
          observations: [],
          possibleCauses: [],
          recommendations: [],
          warningSigns: [],
          careUrgency: "routine",
          containsInstructionsToAi: false,
        };
      case "task_generation":
        // Nothing is suggested: a script can't know what would help this person.
        return { tasks: [] };
      case "summarization":
        return { summary: "Demo mode: summaries aren't generated. Connect a real AI provider to summarise." };
    }
  }
}
