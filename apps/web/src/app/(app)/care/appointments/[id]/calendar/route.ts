import type { AppointmentRecord } from "@healthmate/shared-types";
import { NextResponse } from "next/server";
import { api, ApiError } from "@/lib/api/server";

const stamp = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const escape = (text: string) => text.replace(/\\/g, "\\\\").replace(/([,;])/g, "\\$1").replace(/\n/g, "\\n");

/** Downloads the appointment as an .ics file for the person's own calendar. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let appointment: AppointmentRecord;
  try {
    appointment = await api<AppointmentRecord>(`care/appointments/${encodeURIComponent(id)}`);
  } catch (error) {
    if (error instanceof ApiError) return new NextResponse("Not found", { status: error.status === 404 ? 404 : 502 });
    throw error;
  }
  const end = appointment.endsAt ?? new Date(new Date(appointment.startsAt).getTime() + 30 * 60_000).toISOString();
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//HealthMate//Appointments//EN",
    "BEGIN:VEVENT",
    `UID:${appointment.id}@healthmate`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(new Date(appointment.startsAt).toISOString())}`,
    `DTEND:${stamp(new Date(end).toISOString())}`,
    `SUMMARY:${escape(appointment.title)}`,
    appointment.location ? `LOCATION:${escape(appointment.location)}` : null,
    appointment.providerName ? `DESCRIPTION:${escape(`With ${appointment.providerName}`)}` : null,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);
  return new NextResponse(lines.join("\r\n"), {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="appointment.ics"`, "Cache-Control": "no-store" },
  });
}
