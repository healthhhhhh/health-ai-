import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { MoodSelector } from "./mood-selector";
import { ProgressBar } from "./progress";
import { StatusBadge } from "./status-badge";
import { Tabs } from "./tabs";
import { TaskRow } from "./task-row";
import { IconButton } from "./icon-button";
import { Input } from "./input";

describe("TaskRow", () => {
  it("toggles via its labelled checkbox", async () => {
    const onToggle = vi.fn();
    render(<TaskRow title="Drink water" detail="3 of 5 glasses" time="9:00 AM" completed={false} onToggle={onToggle} />);
    await userEvent.click(screen.getByRole("checkbox", { name: /drink water/i }));
    expect(onToggle).toHaveBeenCalledWith(true);
  });
});

describe("MoodSelector", () => {
  it("is a radio group with one choice per mood", async () => {
    const onChange = vi.fn();
    render(<MoodSelector value="okay" onChange={onChange} />);
    expect(screen.getByRole("group", { name: /how are you feeling/i })).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(5);
    expect(screen.getByRole("radio", { name: "Okay" })).toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: "Great" }));
    expect(onChange).toHaveBeenCalledWith("great");
  });
});

describe("Tabs", () => {
  function Harness() {
    const [v, setV] = useState<"upload" | "analysis" | "history">("upload");
    return (
      <Tabs
        idPrefix="t"
        label="Report views"
        value={v}
        onChange={setV}
        items={[
          { value: "upload", label: "Upload" },
          { value: "analysis", label: "Analysis" },
          { value: "history", label: "History" },
        ]}
      />
    );
  }
  it("supports arrow-key navigation with roving tabindex", async () => {
    render(<Harness />);
    const upload = screen.getByRole("tab", { name: "Upload" });
    upload.focus();
    await userEvent.keyboard("{ArrowRight}");
    const analysis = screen.getByRole("tab", { name: "Analysis" });
    expect(analysis).toHaveAttribute("aria-selected", "true");
    expect(analysis).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "History" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("accessibility primitives", () => {
  it("StatusBadge carries text, not only colour", () => {
    render(<StatusBadge status="warning">Slightly high</StatusBadge>);
    expect(screen.getByText("Slightly high")).toBeInTheDocument();
  });
  it("ProgressBar exposes its value", () => {
    render(<ProgressBar value={2} max={5} label="Plan" />);
    expect(screen.getByRole("progressbar", { name: "Plan" })).toHaveAttribute("aria-valuenow", "2");
  });
  it("IconButton requires an accessible name", () => {
    render(<IconButton label="Notifications" icon={<svg />} />);
    expect(screen.getByRole("button", { name: "Notifications" })).toBeInTheDocument();
  });
  it("Input links its error message", () => {
    render(<Input label="Email" error="Enter a valid email address." />);
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Enter a valid email address.");
  });
});
