import { describe, expect, it } from "vitest";
import { supportEmail } from "./support";

describe("supportEmail", () => {
  it("uses a plain email address", () => {
    expect(supportEmail(" support@example.com ")).toBe("support@example.com");
  });

  it("ignores a missing or malformed value (Help then says it will be published before launch)", () => {
    for (const value of [undefined, "", "  ", "support", "support@example", "a b@example.com", "<x@example.com>", "javascript:alert(1)@x.com\""]) expect(supportEmail(value), String(value)).toBeNull();
  });
});
