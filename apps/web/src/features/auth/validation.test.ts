import { validateSignIn } from "./validation";

describe("validateSignIn", () => {
  it("requires both fields", () => {
    expect(validateSignIn({ email: "", password: "" })).toEqual({ email: "Enter your email address.", password: "Enter your password." });
  });
  it("rejects malformed email and short password", () => {
    expect(validateSignIn({ email: "alex@", password: "short" })).toEqual({ email: "Enter a valid email address.", password: "Passwords are at least 8 characters." });
  });
  it("accepts valid input", () => {
    expect(validateSignIn({ email: "alex@example.com", password: "correct horse" })).toEqual({});
  });
});
