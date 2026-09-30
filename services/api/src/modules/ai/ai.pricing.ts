import type { AiUsage } from "./ai.types";

/** USD per million tokens. */
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/**
 * Built-in list prices (Anthropic first-party API, per million tokens). Keep
 * them current or override with `AI_PRICES`; they drive the internal cost
 * limit, not what anyone is charged.
 */
export const DEFAULT_PRICES: Record<string, ModelPrice> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};

/** Providers that never cost anything (no model is called). */
export const FREE_PROVIDERS = new Set(["development", "demo", "fake", "unavailable"]);

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
    const round = (n: number) => Math.round(n * 1_000_000) / 1_000_000;
    prices[match[1]!] = { input, output: Number(match[3]), cacheRead: match[4] ? Number(match[4]) : round(input * 0.1), cacheWrite: match[5] ? Number(match[5]) : round(input * 1.25) };
  }
  return prices;
}

export class PriceBook {
  private readonly prices: Record<string, ModelPrice>;
  /** Unknown paid models are priced like the most expensive known model, so the limit errs on the safe side. */
  private readonly fallback: ModelPrice;

  constructor(overrides: Record<string, ModelPrice> = {}) {
    this.prices = { ...DEFAULT_PRICES, ...overrides };
    const all = Object.values(this.prices);
    this.fallback = all.reduce((max, p) => (p.input + p.output > max.input + max.output ? p : max), all[0] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  }

  price(provider: string, model: string): ModelPrice {
    if (FREE_PROVIDERS.has(provider)) return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    return this.prices[model] ?? this.prices[model.replace(/-\d{8}$/, "")] ?? this.fallback;
  }

  /** USD, rounded to a millionth of a dollar (the column's precision). */
  cost(provider: string, model: string, usage: AiUsage): number {
    const p = this.price(provider, model);
    const usd = (usage.inputTokens * p.input + usage.outputTokens * p.output + (usage.cacheReadTokens ?? 0) * p.cacheRead + (usage.cacheWriteTokens ?? 0) * p.cacheWrite) / 1_000_000;
    return Math.round(usd * 1_000_000) / 1_000_000;
  }
}

/** The accounting month (UTC), e.g. "2026-09". */
export const billingPeriod = (at: Date = new Date()) => at.toISOString().slice(0, 7);
