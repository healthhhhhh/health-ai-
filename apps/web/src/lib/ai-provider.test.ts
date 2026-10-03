import { describe, expect, it } from "vitest";
import { aiProviderPhrase } from "./ai-provider";

describe("aiProviderPhrase", () => {
  it("names the company that receives the data when the server reports it", () => {
    expect(`Send files to ${aiProviderPhrase(["Anthropic"])} for a summary.`).toBe("Send files to our AI provider, Anthropic, for a summary.");
    expect(aiProviderPhrase(["Anthropic", "Example AI"])).toBe("our AI providers, Anthropic and Example AI,");
  });

  it("stays generic when the server doesn't say (Preview, older servers)", () => {
    expect(aiProviderPhrase(undefined)).toBe("our AI provider");
    expect(aiProviderPhrase([])).toBe("our AI provider");
    expect(aiProviderPhrase(["  "])).toBe("our AI provider");
  });
});
