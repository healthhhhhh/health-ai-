import type { DocumentCreation, DocumentRecord } from "@healthmate/shared-types";
import { unstable_rethrow } from "next/navigation";
import { NextResponse } from "next/server";
import { api, ApiError, errorMessage } from "@/lib/api/server";

const MAX_BYTES = 20 * 1024 * 1024;
const TYPES: Record<string, string[]> = {
  report: ["application/pdf", "image/jpeg", "image/png"],
  image: ["image/jpeg", "image/png"],
};
const PURPOSES = ["skin", "wound", "swelling", "other"];

/**
 * Uploads a report or photo for the signed-in person: creates the record,
 * sends the bytes to the signed upload URL and starts analysis. The API checks
 * the file's real type; the browser never talks to the API directly.
 */
export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    const kind = String(form.get("kind") ?? "report");
    const purpose = String(form.get("purpose") ?? "");
    const note = String(form.get("note") ?? "").trim().slice(0, 500);
    if (!(file instanceof File)) return fail("Choose a file to upload.", 400);
    if (!(kind in TYPES)) return fail("Unknown upload type.", 400);
    if (!TYPES[kind]!.includes(file.type)) return fail(kind === "report" ? "Upload a PDF, JPG or PNG." : "Upload a JPG or PNG photo.", 415);
    if (file.size === 0 || file.size > MAX_BYTES) return fail("Files must be smaller than 20 MB.", 413);
    if (kind === "image" && !PURPOSES.includes(purpose)) return fail("Say what the photo shows.", 400);

    const created = await api<DocumentCreation>("documents", {
      method: "POST",
      json: { kind, filename: file.name.slice(0, 255) || "upload", contentType: file.type, byteSize: file.size, purpose: kind === "image" ? purpose : null },
    });
    // Preview mode keeps files in the browser session only (nothing is stored or analysed).
    if (!created.upload.url.startsWith("preview-upload://")) {
      const upload = await fetch(created.upload.url, { method: "PUT", headers: created.upload.headers, body: Buffer.from(await file.arrayBuffer()) });
      if (!upload.ok) return fail("The upload didn't complete. Please try again.", 502);
    }
    const processed = await api<DocumentRecord>(`documents/${created.document.id}/process`, { method: "POST", json: note ? { note } : {} });
    return NextResponse.json({ id: processed.id });
  } catch (error) {
    unstable_rethrow(error); // redirects when the session has ended
    return fail(errorMessage(error), error instanceof ApiError && error.status ? error.status : 500);
  }
}

function fail(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}
