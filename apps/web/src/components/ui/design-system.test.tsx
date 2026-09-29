import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { AppointmentCard } from "./appointment-card";
import { AIGeneratedLabel, SourceBadge } from "./content-labels";
import { FilterChips, Textarea } from "./fields";
import { ListRow } from "./list-row";
import { MedicationCard } from "./medication-card";
import { NotificationRow } from "./notification-row";
import { StateView } from "./state-view";
import { StepProgress } from "./step-progress";
import { Switch } from "./switch";
import { ToastProvider, useToast } from "./toast";

describe("StateView", () => {
  it("announces errors and offline as alerts, other states politely", () => {
    const { rerender } = render(<StateView state="error" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
    rerender(<StateView state="offline" />);
    expect(screen.getByRole("alert")).toHaveTextContent("You're offline");
    rerender(<StateView state="empty" title="No reports yet" />);
    expect(screen.getByRole("status")).toHaveTextContent("No reports yet");
  });
});

describe("Switch", () => {
  it("toggles through its label", async () => {
    function Harness() {
      const [on, setOn] = useState(false);
      return <Switch label="Medication reminders" checked={on} onChange={setOn} />;
    }
    render(<Harness />);
    const toggle = screen.getByRole("switch", { name: "Medication reminders" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });
});

describe("FilterChips and Textarea", () => {
  it("marks the selected filter and counts characters", async () => {
    function Harness() {
      const [value, setValue] = useState("all");
      const [text, setText] = useState("");
      return (
        <>
          <FilterChips label="Filter" value={value} onChange={setValue} options={[{ value: "all", label: "All" }, { value: "reports", label: "Reports" }]} />
          <Textarea label="Notes" maxLength={20} value={text} onChange={(e) => setText(e.target.value)} />
        </>
      );
    }
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Reports" }));
    expect(screen.getByRole("button", { name: "Reports" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.type(screen.getByLabelText("Notes"), "hello");
    expect(screen.getByText("5/20")).toBeInTheDocument();
  });
});

describe("rows and cards", () => {
  it("renders rows as links or buttons and marks unread without colour alone", () => {
    render(
      <>
        <ListRow title="Notifications" href="/settings/notifications" />
        <NotificationRow category="medication" title="Morning medication" body="As prescribed" time="8:00" read={false} href="/plans" />
      </>,
    );
    expect(screen.getByRole("link", { name: /Notifications/ })).toHaveAttribute("href", "/settings/notifications");
    expect(screen.getByRole("link", { name: /Unread:\s*Morning medication/ })).toBeInTheDocument();
  });

  it("shows medication instructions verbatim with adherence summarised for screen readers", () => {
    render(<MedicationCard name="Morning medication" instruction="As prescribed by your clinician" sourceLabel="From your clinician" lastSevenDays={[true, false, null, true]} />);
    expect(screen.getByText("“As prescribed by your clinician”")).toBeInTheDocument();
    expect(screen.getByLabelText("Last 7 days: 2 of 3 doses logged")).toBeInTheDocument();
  });

  it("formats appointments in the person's time zone", () => {
    render(<AppointmentCard title="Check-up" startsAt="2026-10-02T09:30:00.000Z" timeZone="Asia/Kolkata" mode="video" status="cancelled" />);
    expect(screen.getByText("3:00 PM")).toBeInTheDocument();
    expect(screen.getByText("Video call")).toBeInTheDocument();
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
  });

  it("never labels an AI inference as fact", () => {
    render(
      <>
        <SourceBadge source="ai_inferred" />
        <AIGeneratedLabel basedOn="your sleep data" />
      </>,
    );
    expect(screen.getByText("Unconfirmed · AI suggestion")).toBeInTheDocument();
    expect(screen.getByText(/AI-generated · based on your sleep data · not a diagnosis/)).toBeInTheDocument();
  });

  it("orders steps and marks the current one", () => {
    render(<StepProgress label="Analysis" current={1} steps={[{ label: "Uploaded" }, { label: "Reading" }, { label: "Summary" }]} />);
    const list = screen.getByRole("list", { name: "Analysis" });
    expect(within(list).getAllByRole("listitem")[1]).toHaveAttribute("aria-current", "step");
  });
});

describe("toasts", () => {
  it("shows a confirmation in a live region", async () => {
    function Trigger() {
      const toast = useToast();
      return <button onClick={() => toast({ title: "Saved", tone: "success" })}>Save</button>;
    }
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
  });
});
