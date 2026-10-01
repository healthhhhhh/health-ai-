import { AiUnpricedModelError, type AiUsage } from "./ai.types";

/** USD per million tokens. */
export interface ModelPrice {
  input: number;
  output: number;
  /** Cache reads (prompt caching). */
  cacheRead: number;
  /** Cache writes with the default 5-minute TTL (HealthMate never requests the 1-hour TTL). */
  cacheWrite: number;
}

/**
 * Built-in prices: Anthropic first-party API list prices, USD per million
 * tokens, standard tier (no fast mode, batch, priority tier or data-residency
 * multiplier — HealthMate uses none of them). Source: Anthropic's published
 * model pricing, as captured on PRICES_EFFECTIVE_DATE. Cache writes are 1.25×
 * input (5-minute TTL); cache reads are 0.1× input except where Anthropic
 * publishes a different figure (Opus 5.5: $0.20; Fable 5.1: $0.25).
 *
 * Images and PDFs have no separate price: Anthropic bills them as input
 * tokens, which are included in the usage the API reports. Thinking tokens
 * are billed as output tokens and are included in `output_tokens`.
 *
 * The fallback models are listed so that a server-side refusal fallback
 * (`fallbacks: "default"`), which can answer with another model, is priced
 * from its own reported usage. Override or extend with `AI_PRICES`.
 */
export const PRICES_EFFECTIVE_DATE = "2026-09-25";
export const PRICES_SOURCE = "Anthropic API list prices (platform.claude.com pricing)";

export const DEFAULT_PRICES: Record<string, ModelPrice> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-7": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-6": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
  "claude-fable-5": { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
};

const ZERO: ModelPrice = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const round6 = (n: number) => Math.round(n * 1_000_000) / 1_000_000;

/**
 * `AI_PRICES`: `model=input/output[/cacheRead/cacheWrite]`, comma-separated,
 * USD per million tokens. Cache prices default to 10% / 125% of input.
 */
export function parsePrices(value: string | undefined): Record<string, ModelPrice> {
  const prices: Record<string, ModelPrice> = {};
  for (const entry of (value ?? "").split(",").map((e) => e.trim()).filter(Boolean)) {
    const match = /^([\w.:@/-]+)=(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)(?:\/(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?))?$/.exec(entry);
    if (!match) throw new Error(`Invalid AI_PRICES entry "${entry}" (expected model=input/output[/cacheRead/cacheWrite])`);
    const input = Number(match[2]);
    prices[match[1]!] = { input, output: Number(match[3]), cacheRead: match[4] ? Number(match[4]) : round6(input * 0.1), cacheWrite: match[5] ? Number(match[5]) : round6(input * 1.25) };
  }
  return prices;
}

/** Whether a usage report is complete enough to price (all counts finite and ≥ 0). */
export function isValidUsage(usage: AiUsage | undefined): usage is AiUsage {
  const ok = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0;
  return Boolean(usage && ok(usage.inputTokens) && ok(usage.outputTokens) && (usage.cacheReadTokens === undefined || ok(usage.cacheReadTokens)) && (usage.cacheWriteTokens === undefined || ok(usage.cacheWriteTokens)));
}

/**
 * Prices per model. Fails closed: a paid model without a price throws
 * `AiUnpricedModelError` (requests are refused, startup config is rejected)
 * rather than being charged a guessed amount.
 */
export class PriceBook {
  private readonly prices: Record<string, ModelPrice>;

  constructor(overrides: Record<string, ModelPrice> = {}) {
    this.prices = { ...DEFAULT_PRICES, ...overrides };
  }

  /** `metered`: the provider bills per token (see AiProvider.metered); unmetered providers cost nothing. */
  has(metered: boolean, model: string): boolean {
    return !metered || model in this.prices;
  }

  price(metered: boolean, model: string): ModelPrice {
    if (!metered) return ZERO;
    const price = this.prices[model];
    if (!price) throw new AiUnpricedModelError(model);
    return price;
  }

  /** USD, rounded to a millionth of a dollar (the columns' precision). */
  cost(metered: boolean, model: string, usage: AiUsage): number {
    const p = this.price(metered, model);
    return round6((usage.inputTokens * p.input + usage.outputTokens * p.output + (usage.cacheReadTokens ?? 0) * p.cacheRead + (usage.cacheWriteTokens ?? 0) * p.cacheWrite) / 1_000_000);
  }

  /**
   * The most a request can cost: every estimated input token at the higher of
   * the input and cache-write prices (with a 50% margin for estimation error),
   * plus the full output allowance (`max_tokens`, which also caps thinking).
   * Reserved before the call so concurrent requests can't overrun the limit.
   */
  worstCase(metered: boolean, model: string, estimatedInputTokens: number, maxOutputTokens: number): number {
    const p = this.price(metered, model);
    return round6((Math.ceil(estimatedInputTokens * 1.5) * Math.max(p.input, p.cacheWrite) + maxOutputTokens * p.output) / 1_000_000);
  }

  /** Prices a multi-model usage breakdown. Throws on any unpriced model. */
  costByModel(metered: boolean, entries: { model: string; usage: AiUsage }[]): number {
    return round6(entries.reduce((sum, e) => sum + this.cost(metered, e.model, e.usage), 0));
  }
}

/** The accounting month (UTC), e.g. "2026-09". */
export const billingPeriod = (at: Date = new Date()) => at.toISOString().slice(0, 7);
