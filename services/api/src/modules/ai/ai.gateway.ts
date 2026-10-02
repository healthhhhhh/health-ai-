import { HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import { ApiError } from "../../common/errors";
import { CONFIG, type AppConfig } from "../../config";
import { DATABASE, type Database } from "../../db/database";
import { AiBudgetLedger, type UsageRow } from "./ai.budget";
import { billingPeriod, isValidUsage, PRICES_EFFECTIVE_DATE, PriceBook } from "./ai.pricing";
import { ProcessingPolicy } from "../account/processing-policy";
import { estimateInputTokens, TASK_PROFILES, TASK_PURPOSE, validateTaskOutput } from "./ai.tasks";
import {
  AI_PROVIDERS,
  AiBudgetExceededError,
  AiDeclinedError,
  AiInvalidOutputError,
  AiTimeoutError,
  AiUnavailableError,
  AiUnpricedModelError,
  type AiEffort,
  type AiFailureUsage,
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

export type AiRequestStatus = "ok" | "flagged" | "invalid_output" | "declined" | "unavailable" | "budget_exceeded" | "timeout" | "unpriced" | "error";

export interface ResolvedRoute {
  provider: AiProvider;
  model: string;
  effort: AiEffort;
}

const NO_USAGE: AiUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

/**
 * The single entry point for every AI operation. Features describe a task;
 * the gateway:
 *
 * 0. checks the person's current consent for the task's purpose (`TASK_PURPOSE`,
 *    `ProcessingPolicy`) — refused work reserves nothing and reaches no provider;
 * 1. routes it to a provider and model (`AI_ROUTES`, else the default provider);
 * 2. prices it — a paid model without a price is refused (fail closed);
 * 3. reserves the request's worst-case cost against the person's monthly
 *    limit (`AI_MONTHLY_USER_BUDGET_USD`) atomically in the database, so
 *    concurrent requests can't overrun it — safety-critical requests are
 *    accounted but never refused;
 * 4. calls the provider (the only place providers are called), with a timeout;
 * 5. settles the reservation at the cost of the reported usage — or keeps the
 *    worst case when the provider may have billed without reporting usage —
 *    and writes the `ai_usage` row in the same transaction (idempotent);
 * 6. validates the answer against the task's schema, then checks its content.
 *
 * The user id, task, model, billing period and cost all come from the server
 * (session, code, configuration, clock, price list) — never from a request
 * body. Usage and limits are never shown to people.
 */
@Injectable()
export class AiGateway {
  private readonly logger = new Logger("AiGateway");
  private readonly prices: PriceBook;
  private readonly ledger: AiBudgetLedger;
  private readonly policy: ProcessingPolicy;

  constructor(
    @Inject(AI_PROVIDERS) private readonly providers: AiProviderRegistry,
    @Inject(DATABASE) db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(ProcessingPolicy) policy?: ProcessingPolicy,
  ) {
    this.prices = new PriceBook(config.aiPrices);
    this.ledger = new AiBudgetLedger(db);
    this.policy = policy ?? new ProcessingPolicy(db);
    for (const [task, route] of Object.entries(config.aiRoutes)) {
      if (!providers.byName.has(route.provider)) throw new Error(`AI route for ${task} names provider "${route.provider}", which isn't configured`);
    }
    // Fail closed at startup: every model a paid provider can be routed to must have a price.
    for (const task of Object.keys(TASK_PROFILES) as AiTask[]) {
      const { provider, model } = this.route(task);
      if (!this.prices.has(provider.metered, model)) throw new AiUnpricedModelError(model);
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
    // Consent first, from the latest record — this is also what stops queued work after a
    // withdrawal. Refused work never reaches a provider, reserves nothing and records no usage.
    if (request.userId) await this.policy.assert(request.userId, TASK_PURPOSE[request.task]);
    const { provider, model, effort: routeEffort } = this.route(request.task);
    const profile = TASK_PROFILES[request.task];
    const period = billingPeriod(new Date());
    const base = {
      userId: request.userId,
      task: request.task,
      provider: provider.name,
      model,
      requestedModel: model,
      billingPeriod: period,
      safetyCritical: request.safetyCritical === true,
      priceVersion: PRICES_EFFECTIVE_DATE,
    };
    const row = (fields: Partial<UsageRow> & Pick<UsageRow, "status">): UsageRow => ({
      ...base,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      estimatedCostUsd: 0,
      costUsd: 0,
      costBasis: "none",
      validationIssueCount: 0,
      ...fields,
    });

    if (!provider.available) {
      await this.record(row({ status: "unavailable" }));
      throw new AiUnavailableError("No AI provider is configured on this server.");
    }

    let estimatedCostUsd: number;
    let worstCaseUsd: number;
    try {
      const inputTokens = estimateInputTokens(request.system, request.messages);
      estimatedCostUsd = this.prices.cost(provider.metered, model, { inputTokens, outputTokens: profile.expectedOutputTokens });
      worstCaseUsd = this.prices.worstCase(provider.metered, model, inputTokens, profile.maxOutputTokens);
    } catch (error) {
      if (!(error instanceof AiUnpricedModelError)) throw error;
      this.logger.error(`refused ${request.task}: no price for model ${model}`);
      await this.record(row({ status: "unpriced" }));
      throw new AiUnavailableError("This AI model has no configured price.");
    }

    // Reserve the worst case before calling. People without an id (system work) and free providers aren't limited.
    let reservationId: string | null = null;
    if (request.userId && worstCaseUsd > 0) {
      const limit = this.config.AI_MONTHLY_USER_BUDGET_USD;
      reservationId = await this.ledger.reserve({
        userId: request.userId,
        billingPeriod: period,
        task: request.task,
        provider: provider.name,
        model,
        amountUsd: worstCaseUsd,
        // Safety-critical requests get extra headroom above the normal limit, but not unlimited
        // spend: past it, callers fall back to deterministic safety guidance (ChatService).
        limitUsd: limit === 0 ? null : request.safetyCritical ? limit + this.config.AI_SAFETY_CRITICAL_ALLOWANCE_USD : limit,
        safetyCritical: request.safetyCritical === true,
        ttlMs: this.config.AI_REQUEST_TIMEOUT_MS + 60_000,
      });
      if (!reservationId) {
        await this.record(row({ status: "budget_exceeded", estimatedCostUsd }));
        this.logger.warn(`monthly AI cost limit reached for a user (${request.task})`);
        throw new AiBudgetExceededError();
      }
    }

    /** Settles the reservation (or records usage) for how the call ended. */
    const finish = async (status: AiRequestStatus, outcome: AiFailureUsage & { usageByModel?: AiProviderResponse["usageByModel"]; actualCostUsd?: number; issueCount?: number }) => {
      const charged = this.charge(provider, model, worstCaseUsd, outcome);
      const usage = isValidUsage(outcome.usage) ? outcome.usage : NO_USAGE;
      const final = row({
        status,
        model: outcome.model ?? model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens ?? 0,
        cacheWriteTokens: usage.cacheWriteTokens ?? 0,
        estimatedCostUsd,
        costUsd: charged.costUsd,
        costBasis: charged.costBasis,
        validationIssueCount: outcome.issueCount ?? 0,
      });
      if (reservationId) await this.ledger.settle(reservationId, final, charged.costUsd === 0 ? "released" : "settled");
      else await this.record(final);
      return charged.costUsd;
    };

    let response: AiProviderResponse;
    const call = provider.generate({
          task: request.task,
          model,
          system: request.system,
          messages: request.messages,
          schema: request.schema,
          effort: request.effort ?? routeEffort,
          maxOutputTokens: profile.maxOutputTokens,
        });
    try {
      response = await this.withTimeout(call);
    } catch (error) {
      if (error instanceof AiTimeoutError && reservationId) {
        // The call may still finish. If it reports more than the worst case it was charged,
        // the difference is added once (the ledger never lowers a charge).
        void call
          .then((late) => (isValidUsage(late.usage) || late.usageByModel?.length || late.actualCostUsd !== undefined ? finish("timeout", late) : undefined))
          .catch(() => undefined);
      }
      // Unexpected errors may have happened after the provider processed the request: charge the worst case.
      const failure: AiFailureUsage = error instanceof AiUnavailableError || error instanceof AiDeclinedError || error instanceof AiInvalidOutputError ? error.failure : { usageUnknown: true };
      await finish(statusOf(error), failure).catch((e) => this.logger.error(`couldn't settle AI usage (${e instanceof Error ? e.name : "error"})`));
      throw error;
    }

    // An answer without usage metadata was still billed by the provider.
    const usageUnknown = !isValidUsage(response.usage) && !response.usageByModel?.length && response.actualCostUsd === undefined;
    const parsed = request.schema.safeParse(response.data);
    if (!parsed.success) {
      // Tokens were spent even though the answer can't be used.
      await finish("invalid_output", { ...response, usageUnknown });
      throw new AiInvalidOutputError();
    }
    const issues = validateTaskOutput(request.task, parsed.data);
    const costUsd = await finish(issues.length ? "flagged" : "ok", { ...response, usageUnknown, issueCount: issues.length });
    return { data: parsed.data, issues, provider: provider.name, model: response.model, usage: isValidUsage(response.usage) ? response.usage : NO_USAGE, costUsd };
  }

  /** Settled AI cost for a person this month (USD). Internal only — never returned to clients. */
  async monthlySpend(userId: string, period = billingPeriod(new Date())): Promise<number> {
    return (await this.ledger.balance(userId, period)).spent;
  }

  /** Charges reservations left held by crashed processes (maintenance). */
  expireStaleReservations() {
    return this.ledger.expireStale(null);
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

  /**
   * What a finished call costs: the provider's own billed amount; else the
   * reported usage priced per model; else (usage unknown, or a model without a
   * price) the reserved worst case — never less than could have been billed.
   */
  private charge(provider: AiProvider, model: string, worstCaseUsd: number, outcome: AiFailureUsage & { usageByModel?: AiProviderResponse["usageByModel"]; actualCostUsd?: number }): { costUsd: number; costBasis: UsageRow["costBasis"] } {
    if (!provider.metered) return { costUsd: 0, costBasis: "none" };
    if (outcome.actualCostUsd !== undefined && Number.isFinite(outcome.actualCostUsd) && outcome.actualCostUsd >= 0) return { costUsd: outcome.actualCostUsd, costBasis: "usage" };
    try {
      if (outcome.usageByModel?.length) {
        if (outcome.usageByModel.every((e) => isValidUsage(e.usage))) return { costUsd: this.prices.costByModel(true, outcome.usageByModel), costBasis: "usage" };
        // A malformed per-model breakdown can't be trusted: charge at least the worst case.
        const total = isValidUsage(outcome.usage) ? this.prices.cost(true, outcome.model ?? model, outcome.usage) : 0;
        return { costUsd: Math.max(worstCaseUsd, total), costBasis: "reservation" };
      }
      if (isValidUsage(outcome.usage)) return { costUsd: this.prices.cost(true, outcome.model ?? model, outcome.usage), costBasis: "usage" };
    } catch (error) {
      if (!(error instanceof AiUnpricedModelError)) throw error;
      // A fallback model we have no price for answered: charge the worst case, loudly.
      this.logger.error(`no price for model ${error.model}; charged the reservation`);
      return { costUsd: worstCaseUsd, costBasis: "reservation" };
    }
    return outcome.usageUnknown ? { costUsd: worstCaseUsd, costBasis: "reservation" } : { costUsd: 0, costBasis: "none" };
  }

  private async withTimeout<R>(promise: Promise<R>): Promise<R> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new AiTimeoutError()), this.config.AI_REQUEST_TIMEOUT_MS);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async record(row: UsageRow) {
    await this.ledger.record(row).catch((error) => this.logger.warn(`couldn't record AI usage (${error instanceof Error ? error.name : "error"})`));
  }
}

function statusOf(error: unknown): AiRequestStatus {
  if (error instanceof AiTimeoutError) return "timeout";
  if (error instanceof AiDeclinedError) return "declined";
  if (error instanceof AiInvalidOutputError) return "invalid_output";
  if (error instanceof AiUnavailableError) return "unavailable";
  return "error";
}
