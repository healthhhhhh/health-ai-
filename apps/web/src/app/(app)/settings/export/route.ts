import { api } from "@/lib/api/server";

/** Downloads everything HealthMate holds about the signed-in person as JSON. */
export async function GET() {
  const data = await api<Record<string, unknown>>("me/export");
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="healthmate-export-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
