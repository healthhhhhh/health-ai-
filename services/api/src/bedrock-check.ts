import { z } from "zod";
import { aiProvidersFor } from "./adapters";
import { loadConfig, type AppConfig } from "./config";
import { createDatabase, migrate, type Database } from "./db/database";
import { AiGateway, registryOf, type AiProviderRegistry } from "./modules/ai/ai.gateway";
import { AiUnavailableError, AiUnpricedModelError } from "./modules/ai/ai.types";

export const BILLABLE_FLAG = "--yes-make-a-billable-request";

/**
 * `npm run bedrock:check -w @healthmate/api`: checks the Bedrock settings in `.env`.
 *
 * Without BILLABLE_FLAG it sends nothing: it validates the configuration and
 * prints free AWS CLI checks for model availability. With the flag it sends ONE
 * tiny synthetic request through the AI Gateway (as system work: no person, so
 * no consent or per-person limit applies; the gateway records its usage and cost)
 * to confirm the key, Region and model work together. Bedrock bills that
 * request. The key is never printed.
 */
export async function bedrockCheck(
  config: AppConfig,
  options: { billable: boolean; db?: Database; providers?: AiProviderRegistry },
  print: (line: string) => void,
): Promise<boolean> {
  const { AWS_REGION: region, BEDROCK_MODEL_ID: model } = config;
  if (!config.aiProvidersInUse.includes("bedrock") || !region || !model || !config.AWS_BEARER_TOKEN_BEDROCK) {
    print("Bedrock isn't selected: set AI_PROVIDER=bedrock, AWS_BEARER_TOKEN_BEDROCK, AWS_REGION and BEDROCK_MODEL_ID in .env.");
    return false;
  }
  const price = config.aiPrices[model];
  print(`Region: ${region}`);
  print(`Model: ${model}`);
  print("API key: set (not shown)");
  print(price ? `Price: ${price.input}/${price.output} USD per million tokens (from your AI_PRICES — not verified here)` : "Price: MISSING — add an AI_PRICES entry for this model from the AWS Bedrock pricing page, or the API refuses to start.");
  if (!options.billable) {
    print("");
    print("No request was sent. Free checks with the AWS CLI (uses your AWS CLI credentials, not this key):");
    print(`  aws bedrock get-foundation-model-availability --region ${region} --model-id <foundation model ID>`);
    print(`  aws bedrock list-inference-profiles --region ${region}   # if BEDROCK_MODEL_ID is an inference profile (e.g. us.…)`);
    print(`To send one small billable test request: npm run bedrock:check -w @healthmate/api -- ${BILLABLE_FLAG}`);
    return Boolean(price);
  }
  if (!price) return false;

  const bedrock = (options.providers ?? aiProvidersFor(config)).byName.get("bedrock")!;
  const db = options.db ?? (await createDatabase({ url: config.DATABASE_URL, pgliteDir: config.PGLITE_DIR, caCert: config.DATABASE_CA_CERT }));
  try {
    if (!options.db) await migrate(db);
    // Every task goes to Bedrock here, whatever AI_ROUTES says, so this checks BEDROCK_MODEL_ID.
    let gateway: AiGateway;
    try {
      gateway = new AiGateway(registryOf(bedrock), db, { ...config, aiRoutes: {} });
    } catch (error) {
      if (error instanceof AiUnpricedModelError) print("FAILED: no AI_PRICES entry for this model.");
      else throw error;
      return false;
    }
    const res = await gateway.generate({
      task: "summarization",
      userId: null,
      system: ["This is a connectivity test with synthetic data. Set summary to the word ok."],
      messages: [{ role: "user", content: "Connectivity test. No health information is included." }],
      schema: z.object({ summary: z.string() }),
    });
    print(`OK: ${res.model} answered (${res.usage.inputTokens} input / ${res.usage.outputTokens} output tokens, estimated $${res.costUsd.toFixed(6)} at your AI_PRICES).`);
    return true;
  } catch (error) {
    // The provider logged the AWS error name and a hint (never the key or message text).
    print(`FAILED: ${error instanceof AiUnavailableError ? "Bedrock refused or couldn't complete the request — see the log line above." : error instanceof Error ? error.name : "error"}`);
    return false;
  } finally {
    if (!options.db) await db.close();
  }
}

if (require.main === module) {
  // eslint-disable-next-line no-console
  const print = (line: string) => console.log(line);
  bedrockCheck(loadConfig(), { billable: process.argv.includes(BILLABLE_FLAG) }, print)
    .then((ok) => process.exit(ok ? 0 : 1))
    .catch((error) => {
      print(error instanceof Error ? error.message : "error");
      process.exit(1);
    });
}
