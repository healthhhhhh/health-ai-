"use client";

import { Activity, Bell, CalendarClock, Camera, FileText, HeartPulse, MapPin, Pill } from "lucide-react";
import { useState } from "react";
import { AppointmentCard } from "@/components/ui/appointment-card";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { AIGeneratedLabel, SampleContentLabel, SourceBadge, type Provenance } from "@/components/ui/content-labels";
import { FilterChips, Select, Textarea } from "@/components/ui/fields";
import { Input } from "@/components/ui/input";
import { ListGroup, ListRow } from "@/components/ui/list-row";
import { MedicationCard } from "@/components/ui/medication-card";
import { MetricCard } from "@/components/ui/metric-card";
import { NotificationRow } from "@/components/ui/notification-row";
import { PermissionPrimer } from "@/components/ui/permission-primer";
import { ProviderCard } from "@/components/ui/provider-card";
import { ReportCard } from "@/components/ui/report-card";
import { Sheet } from "@/components/ui/sheet";
import { SkeletonCard, SkeletonList } from "@/components/ui/skeleton";
import { StateView, type ViewState } from "@/components/ui/state-view";
import { StatusBadge } from "@/components/ui/status-badge";
import { StepProgress } from "@/components/ui/step-progress";
import { Switch } from "@/components/ui/switch";
import { TaskRow } from "@/components/ui/task-row";
import { TimelineItem } from "@/components/ui/timeline-item";
import { useToast } from "@/components/ui/toast";

const STATES: ViewState[] = ["loading", "processing", "empty", "error", "offline", "permission", "success"];
const SOURCES: Provenance[] = ["user_reported", "user_confirmed", "clinician_provided", "document_extracted", "healthkit", "ai_inferred", "sample"];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <h2 className="text-section-heading text-text-primary">{title}</h2>
      {children}
    </section>
  );
}

export function DesignGallery({ timeZone }: { timeZone: string }) {
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [switchOn, setSwitchOn] = useState(true);
  const [filter, setFilter] = useState("all");
  const [note, setNote] = useState("");
  const [done, setDone] = useState(false);
  const [soon] = useState(() => new Date(Date.now() + 3 * 86_400_000).toISOString());

  return (
    <div className="flex flex-col gap-10">
      <SampleContentLabel>Examples only — values on this page are illustrative.</SampleContentLabel>

      <Section title="Buttons">
        <div className="flex flex-wrap gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="soft">Soft</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Delete</Button>
          <Button disabled>Disabled</Button>
        </div>
      </Section>

      <Section title="Inputs">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Input label="Email" type="email" placeholder="you@example.com" hint="We'll never share it." />
          <Input label="Name" error="Enter your first name." />
          <Select label="Reminder" options={[{ value: "08:00", label: "8:00 AM" }, { value: "20:00", label: "8:00 PM" }]} />
          <Textarea label="Notes" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything to remember" />
        </div>
        <FilterChips label="Filter" value={filter} onChange={setFilter} options={[{ value: "all", label: "All", count: 12 }, { value: "reports", label: "Reports", count: 4 }, { value: "photos", label: "Photos", count: 2 }]} />
        <Card>
          <Switch label="Medication reminders" description="A reminder at each scheduled time." checked={switchOn} onChange={setSwitchOn} />
        </Card>
      </Section>

      <Section title="Screen states">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {STATES.map((state) => (
            <Card key={state}>
              <StateView state={state} compact action={state === "error" || state === "offline" ? <Button size="sm" variant="secondary">Try again</Button> : undefined} />
            </Card>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <SkeletonCard />
          <SkeletonList rows={3} label="Loading example list" />
        </div>
        <Card>
          <CardHeader title="Processing steps" />
          <StepProgress label="Report analysis" current={1} steps={[{ label: "Uploaded" }, { label: "Reading the report", detail: "Usually under a minute" }, { label: "Writing a plain-language summary" }]} />
        </Card>
      </Section>

      <Section title="Feedback">
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => toast({ title: "Saved", description: "Your reminder settings were updated.", tone: "success" })}>
            Show success toast
          </Button>
          <Button variant="secondary" onClick={() => toast({ title: "Couldn't save", description: "Please try again.", tone: "error" })}>
            Show error toast
          </Button>
          <Button variant="secondary" onClick={() => setConfirm(true)}>
            Confirmation dialog
          </Button>
          <Button variant="secondary" onClick={() => setSheet(true)}>
            Sheet
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge status="success">Within range</StatusBadge>
          <StatusBadge status="warning">Above range</StatusBadge>
          <StatusBadge status="error">Failed</StatusBadge>
          <StatusBadge status="info">Processing</StatusBadge>
          <StatusBadge status="neutral">Cancelled</StatusBadge>
        </div>
        <ConfirmDialog
          open={confirm}
          onClose={() => setConfirm(false)}
          title="Delete this report?"
          description="The file and its summary will be removed. This can't be undone."
          confirmLabel="Delete report"
          destructive
          onConfirm={() => toast({ title: "Report deleted", tone: "success" })}
        />
        <Sheet open={sheet} onClose={() => setSheet(false)} title="Add appointment" description="Sheets hold short forms." footer={<Button onClick={() => setSheet(false)}>Save</Button>}>
          <div className="flex flex-col gap-4">
            <Input label="Title" placeholder="Annual check-up" />
            <Input label="Date" type="date" />
          </div>
        </Sheet>
      </Section>

      <Section title="Labels">
        <div className="flex flex-wrap gap-2">
          {SOURCES.map((s) => (
            <SourceBadge key={s} source={s} />
          ))}
        </div>
        <AIGeneratedLabel basedOn="your sleep data from the last 14 days" />
        <SampleContentLabel />
      </Section>

      <Section title="Rows and lists">
        <ListGroup title="Settings" footer="Rows lead somewhere, show a value, or both.">
          <ListRow icon={<Bell />} title="Notifications" subtitle="Reminders, reports and appointments" href="/design" />
          <ListRow icon={<HeartPulse />} tone="red" title="Apple Health" trailing="Connected" href="/design" />
          <ListRow icon={<MapPin />} tone="teal" title="Units" trailing="Metric" onClick={() => toast({ title: "Tapped", tone: "info" })} />
        </ListGroup>
        <ListGroup title="Notifications">
          <NotificationRow category="medication" title="Time for your morning medication" body="Morning medication · as prescribed" time="8:00 AM" read={false} href="/design" />
          <NotificationRow category="insight" title="Your sleep is trending up" body="About 20 minutes longer on average this month." time="Yesterday" read aiGenerated href="/design" />
        </ListGroup>
      </Section>

      <Section title="Health cards">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Steps" value="6,428" unit="steps" icon={<Activity />} tone="green" context="In your usual range" />
          <MetricCard label="Heart rate" value="72" unit="bpm" icon={<HeartPulse />} tone="red" context="In your usual range" />
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <MedicationCard name="Morning medication" instruction="As prescribed by your clinician" sourceLabel="From your clinician" schedule="Daily · 8:00 AM" takenToday lastSevenDays={[true, true, false, true, true, true, null]} href="/design" />
          <Card>
            <TaskRow title="Evening walk" detail="30 minutes" time="18:30" completed={done} onToggle={() => setDone((v) => !v)} />
          </Card>
          <AppointmentCard title="Annual check-up" providerName="Dr. Sam Lee" startsAt={soon} timeZone={timeZone} mode="in_person" location="Riverside Health Centre" href="/design" />
          <ProviderCard name="Dr. Sam Lee" specialty="General practice" phone="+44 20 7946 0001" address="Riverside Health Centre, 12 Mill Lane" href="/design" />
          <ReportCard fileName="Example blood test.pdf" meta="Lab results · 2 days ago" href="/design" status={<StatusBadge status="success">Ready</StatusBadge>} />
          <Card as="ol" aria-label="Timeline example">
            <TimelineItem icon={<FileText />} tone="purple" title="Example blood test analysed" meta="From a report" time="10:03" />
            <TimelineItem icon={<Pill />} tone="blue" title="Morning medication taken" meta="Added by you" time="08:04" />
            <TimelineItem icon={<CalendarClock />} tone="teal" title="Annual check-up" meta="Dr. Sam Lee" time="Thu" isLast />
          </Card>
        </div>
      </Section>

      <Section title="Permissions">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <PermissionPrimer
            icon={<HeartPulse />}
            tone="red"
            title="Connect Apple Health"
            description="See your steps, sleep and heart rate next to your plan."
            benefits={["Trends compared with your own usual range", "Nothing is shared without your say-so"]}
            privacyNote="HealthMate only reads the data types you choose. You can disconnect at any time."
            actions={<Button>Continue</Button>}
          />
          <PermissionPrimer
            icon={<Camera />}
            tone="orange"
            title="Camera access is off"
            description="Needed to photograph a report or a skin concern."
            status="denied"
            deniedHelp="Turn on Camera for HealthMate in your device's Settings › Privacy."
            actions={<Button variant="secondary">Choose a file instead</Button>}
          />
        </div>
      </Section>
    </div>
  );
}
