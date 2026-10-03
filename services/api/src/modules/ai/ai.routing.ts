import { AI_TASKS, type AiEffort, type AiTask } from "./ai.types";

/** Provider names a route can use. "none" means the honest "unavailable" provider. */
export const AI_PROVIDER_NAMES = ["anthropic", "development", "bedrock", "none"] as const;
export type AiProviderName = (typeof AI_PROVIDER_NAMES)[number];

/**
 * The outside company behind each provider that receives people's data. The
 * offline development provider and "none" send nothing anywhere. A new provider
 * must be added here, so consent screens keep naming who receives the data.
 */
const AI_PROVIDER_COMPANIES: Record<AiProviderName, string | null> = { anthropic: "Anthropic", development: null, bedrock: "Amazon Web Services", none: null };

/** Companies that receive data for AI processing with this configuration (for consent screens). */
export function aiDataRecipients(providers: readonly AiProviderName[]): string[] {
  return [...new Set(providers.map((p) => AI_PROVIDER_COMPANIES[p]).filter((c): c is string => c !== null))];
}

export interface AiRouteConfig {
  /** Registry name of the provider ("unavailable" for "none"). */
  provider: string;
  model?: string;
  effort?: AiEffort;
}

export type AiRoutes = Partial<Record<AiTask, AiRouteConfig>>;

/** The registry name a configured provider is known by. */
export const registryName = (name: AiProviderName) => (name === "none" ? "unavailable" : name);

/**
 * `AI_ROUTES`: `task=provider[:model][@effort]`, comma-separated, e.g.
 * `complex_health=anthropic:claude-opus-5-5@high,summarization=anthropic:claude-haiku-4-5@low`.
 * Tasks without a route use `AI_PROVIDER` with its default model.
 */
export function parseRoutes(value: string | undefined): { routes: AiRoutes; providers: AiProviderName[] } {
  const routes: AiRoutes = {};
  const providers = new Set<AiProviderName>();
  for (const entry of (value ?? "").split(",").map((e) => e.trim()).filter(Boolean)) {
    const match = /^(\w+)=(\w+)(?::([\w.\-/]+))?(?:@(low|medium|high))?$/.exec(entry);
    if (!match) throw new Error(`Invalid AI_ROUTES entry "${entry}" (expected task=provider[:model][@effort])`);
    const [, task, provider, model, effort] = match;
    if (!(AI_TASKS as readonly string[]).includes(task!)) throw new Error(`AI_ROUTES: unknown task "${task}" (tasks: ${AI_TASKS.join(", ")})`);
    if (!(AI_PROVIDER_NAMES as readonly string[]).includes(provider!)) throw new Error(`AI_ROUTES: unknown provider "${provider}" (providers: ${AI_PROVIDER_NAMES.join(", ")})`);
    if (routes[task as AiTask]) throw new Error(`AI_ROUTES: "${task}" is routed twice`);
    providers.add(provider as AiProviderName);
    routes[task as AiTask] = { provider: registryName(provider as AiProviderName), ...(model ? { model } : {}), ...(effort ? { effort: effort as AiEffort } : {}) };
  }
  return { routes, providers: [...providers] };
}
