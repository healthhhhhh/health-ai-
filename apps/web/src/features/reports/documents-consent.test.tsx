import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DocumentsConsent } from "./documents-consent";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/features/chat/actions", () => ({ setConsent: vi.fn() }));

describe("DocumentsConsent", () => {
  it("names the AI company that receives the files when the server reports it", () => {
    const { unmount } = render(<DocumentsConsent aiRecipients={["Anthropic"]} />);
    expect(screen.getByText(/sent to our AI provider, Anthropic, to create a summary/)).toBeInTheDocument();
    unmount();
    render(<DocumentsConsent />);
    expect(screen.getByText(/sent to our AI provider to create a summary/)).toBeInTheDocument();
  });
});
