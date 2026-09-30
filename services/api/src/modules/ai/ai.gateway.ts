import { HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import { ApiError } from "../../common/errors";
import { CONFIG, type AppConfig } from "../../config";
import { DATABASE, type Database } from "../../db/database";
import { billingPeriod, PriceBook } from "./ai.pricing";
import { estimateInputTokens, TASK_PROFILES, validateTaskOutput } from "./ai.tasks";
import {
  AI_PROVIDERS,
  AiBudgetExceededError,
  AiDeclinedError,
  AiInvalidOutputError,
  AiUnavailableError,
  type AiEffort,
  type AiProvider,
  type AiProviderResponse,
  type AiTask,
  type AiTaskRequest,
  type AiTaskResult,
  type AiUsage,
} from "./ai.types";

/** The configured providers. `default` serves every task without its own route. */
export interface AiProviderRegistry {
  default: AiProvider;
  byName: Map<string, AiProvider>;
}

export const registryOf = (defaultProvider: AiProvider, others: AiProvider[] = []): AiProviderRegistry => ({
  default: defaultProvider,
  byName: new Map([defaultProvider, ...others].map((p) => [p.name, p])),
});

export type AiRequestStatus = "ok" | "flagged" | "invalid_output" | "declined" | "unavailable" | "budget_exceeded" | "error";

export interface ResolvedRoute {
  provider: AiProvider;
  model: string;
  effort: AiEffort;
}

/**
 * The single entry point for every AI operation. Features describe a task;
 * the gateway:
 *
 * 1. routes it to a provider and model (`AI_ROUTES`, else the default provider);
 * 2. enforces the internal monthly cost limit per person
 *    (`AI_MONTHLY_USER_BUDGET_USD`) — except for safety-critical requests;
 * 3. calls the provider (the only place providers are called);
 * 4. validates the answer against the task's schema, then checks its content
 *    (diagnoses, doses, injected instructions, medication changes);
 * 5. records usage and cost in `ai_usage` (token counts and ids only — never
 *    prompts or answers). Usage and limits are never shown to people.
 */
@Injectable()
export class AiGateway {
  private readonly logger = new Logger("AiGateway");
  private readonly prices: PriceBook;

  constructor(
    @Inject(AI_PROVIDERS) private readonly providers: AiProviderRegistry,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {
    this.prices = new PriceBook(config.aiPrices);
    for (const [task, route] of Object.entries(config.aiRoutes)) {
      if (!providers.byName.has(route.provider)) throw new Error(`AI route for ${task} names provider "${route.provider}", which isn't configured`);
    }
  }

  /** Whether the default route can answer (clients show an "unavailable" state otherwise). */
  get available() {
    return this.providers.default.available;
  }

  /** Scripted answers: clients show a demo notice. */
  get demo() {
    return this.providers.default.demo === true;
  }

  route(task: AiTask): ResolvedRoute {
    const configured = this.config.aiRoutes[task];
    const provider = (configured && this.providers.byName.get(configured.provider)) || this.providers.default;
    return { provider, model: configured?.model ?? provider.defaultModel, effort: configured?.effort ?? TASK_PROFILES[task].effort };
  }

  async generate<T>(request: AiTaskRequest<T>): Promise<AiTaskResult<T>> {
    const { provider, model, effort: routeEffort } = this.route(request.task);
    const profile = TASK_PROFILES[request.task];
    const period = billingPeriod(new Date());
    const estimatedCostUsd = this.prices.cost(provider.name, model, { inputTokens: estimateInputTokens(request.system, request.messages), outputTokens: profile.expectedOutputTokens });
    const entry = { request, period, provider: provider.name, model, estimatedCostUsd };

    if (!provider.available) {
      await this.record({ ...entry, status: "unavailable" });
      throw new AiUnavailableError("No AI provider is configured on this server.");
    }
    if (request.userId && !request.safetyCritical && estimatedCostUsd > 0 && this.config.AI_MONTHLY_USER_BUDGET_USD > 0) {
      const spent = await this.monthlySpend(request.userId, period);
      if (spent + estimatedCostUsd > this.config.AI_MONTHLY_USER_BUDGET_USD) {
        await this.record({ ...entry, status: "budget_exceeded" });
        this.logger.warn(`monthly AI cost limit reached for a user (${request.task})`);
        throw new AiBudgetExceededError();
      }
    }

    let response: AiProviderResponse;
    try {
      response = await provider.generate({
        task: request.task,
        model,
        system: request.system,
        messages: request.messages,
        schema: request.schema,
        effort: request.effort ?? routeEffort,
        maxOutputTokens: profile.maxOutputTokens,
      });
    } catch (error) {
      await this.record({ ...entry, status: statusOf(error) });
      throw error;
    }

    const answered = { ...entry, model: response.model, usage: response.usage, costUsd: response.actualCostUsd ?? this.prices.cost(provider.name, response.model, response.usage) };
    const parsed = request.schema.safeParse(response.data);
    if (!parsed.success) {
      // Tokens were spent even though the answer can't be used.
      await this.record({ ...answered, status: "invalid_output" });
      throw new AiInvalidOutputError();
    }
    const issues = validateTaskOutput(request.task, parsed.data);
    await this.record({ ...answered, status: issues.length ? "flagged" : "ok", issueCount: issues.length });
    return { data: parsed.data, issues, provider: provider.name, model: response.model, usage: response.usage, costUsd: answered.costUsd };
  }

  /** What a person's AI use has cost this month (USD). Internal only — never returned to clients. */
  async monthlySpend(userId: string, period = billingPeriod(new Date())): Promise<number> {
    const { rows } = await this.db.query<{ total: string | number | null }>(`SELECT COALESCE(SUM(cost_usd), 0) AS total FROM ai_usage WHERE user_id = $1 AND billing_period = $2`, [userId, period]);
    return Number(rows[0]?.total ?? 0);
  }

  /** Converts AI failures into API errors that say plainly no answer was produced. */
  static toApiError(error: unknown): unknown {
    if (error instanceof AiUnavailableError || error instanceof AiBudgetExceededError) {
      // The cost limit reads like any other unavailability: no balances or credits are shown.
      return new ApiError("ai_unavailable", "The AI response couldn't be generated right now. Nothing was analysed — please try again later.", HttpStatus.SERVICE_UNAVAILABLE);
    }
    if (error instanceof AiDeclinedError) {
      return new ApiError("ai_declined", "The AI couldn't help with this request. If you're worried about your health, please contact a clinician.", HttpStatus.UNPROCESSABLE_ENTITY);
    }
    if (error instanceof AiInvalidOutputError) {
      return new ApiError("ai_invalid_output", "The AI response couldn't be generated reliably. Please try again.", HttpStatus.BAD_GATEWAY);
    }
    return error;
  }

  private async record(entry: {
    request: AiTaskRequest<unknown>;
    period: string;
    provider: string;
    model: string;
    estimatedCostUsd: number;
    status: AiRequestStatus;
    usage?: AiUsage;
    costUsd?: number;
    issueCount?: number;
  }) {
    const usage = entry.usage ?? { inputTokens: 0, outputTokens: 0 };
    await this.db
      .query(
        `INSERT INTO ai_usage (user_id, feature, task, provider, model, billing_period, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
                               estimated_cost_usd, cost_usd, outcome, status, safety_critical, validation_issue_count)
         VALUES ($1, $2, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12, $13, $14)`,
        [
          entry.request.userId,
          entry.request.task,
          entry.provider,
          entry.model,
          entry.period,
          usage.inputTokens,
          usage.outputTokens,
          usage.cacheReadTokens ?? 0,
          usage.cacheWriteTokens ?? 0,
          entry.estimatedCostUsd,
          entry.costUsd ?? 0,
          entry.status,
          entry.request.safetyCritical === true,
          entry.issueCount ?? 0,
        ],
      )
      .catch((error) => this.logger.warn(`couldn't record AI usage (${error instanceof Error ? error.name : "error"})`));
  }
}

function statusOf(error: unknown): AiRequestStatus {
  if (error instanceof AiDeclinedError) return "declined";
  if (error instanceof AiInvalidOutputError) return "invalid_output";
  if (error instanceof AiUnavailableError) return "unavailable";
  return "error";
}
