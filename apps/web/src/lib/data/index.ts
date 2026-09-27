import type { HealthMateClient } from "./client";
import { HttpHealthMateClient } from "./http-client";
import { MockHealthMateClient } from "./mock-client";

export type { HealthMateClient, ShellContext } from "./client";
export { ApiError } from "./client";

let client: HealthMateClient | undefined;

/** Returns the configured data client (sample data unless NEXT_PUBLIC_DATA_SOURCE=api). */
export function getDataClient(): HealthMateClient {
  if (!client) {
    const source = process.env.NEXT_PUBLIC_DATA_SOURCE ?? "mock";
    const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
    client = source === "api" && baseUrl ? new HttpHealthMateClient(baseUrl) : new MockHealthMateClient();
  }
  return client;
}
