import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SignInForm } from "./sign-in-form";

vi.mock("./actions", () => ({ authenticate: vi.fn(), continueWithProvider: vi.fn() }));

describe("SignInForm", () => {
  it("shows Apple and Google only when the page says they can work", () => {
    const { unmount } = render(<SignInForm />);
    expect(screen.queryByRole("button", { name: /continue with (apple|google)/i })).toBeNull();
    expect(screen.queryByText(/or use email/i)).toBeNull();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    unmount();

    render(<SignInForm socialSignIn />);
    expect(screen.getByRole("button", { name: "Continue with Apple" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeInTheDocument();
  });
});
