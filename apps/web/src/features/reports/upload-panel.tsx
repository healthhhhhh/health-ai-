"use client";

import { Camera, FileUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { UploadDropzone } from "@/components/ui/upload-dropzone";

/** Re-encodes a photo as JPEG in the browser, which also drops location and other metadata. */
async function cleanImage(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) throw new Error("We couldn't read that photo.");
  return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
}

async function upload(form: FormData): Promise<string> {
  const res = await fetch("/reports/upload", { method: "POST", body: form });
  const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
  if (!res.ok || !body.id) throw new Error(body.error ?? "The upload didn't complete. Please try again.");
  return body.id;
}

export function UploadPanel() {
  const router = useRouter();
  const [mode, setMode] = useState<"report" | "image">("report");
  const [purpose, setPurpose] = useState("skin");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const onFile = (file: File) =>
    start(async () => {
      setError(null);
      try {
        const clean = file.type === "application/pdf" ? file : await cleanImage(file);
        const form = new FormData();
        form.set("file", clean);
        form.set("kind", mode);
        if (mode === "image") {
          form.set("purpose", purpose);
          if (note.trim()) form.set("note", note.trim());
        }
        const id = await upload(form);
        router.push(`/reports/${id}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "The upload didn't complete. Please try again.");
      }
    });

  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label="What are you uploading?" className="inline-flex gap-1 self-start rounded-pill bg-card-muted p-1 ring-1 ring-separator">
        {(
          [
            ["report", "Medical report", FileUp],
            ["image", "Photo check", Camera],
          ] as const
        ).map(([value, label, Icon]) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            onClick={() => setMode(value)}
            className={`flex h-9 items-center gap-2 rounded-pill px-4 text-caption font-semibold ${mode === value ? "bg-card text-primary shadow-card" : "text-text-secondary"}`}
          >
            <Icon aria-hidden className="size-4" /> {label}
          </button>
        ))}
      </div>

      {mode === "image" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-caption font-semibold text-text-primary">
            What does it show?
            <select value={purpose} onChange={(e) => setPurpose(e.target.value)} className="h-11 rounded-md bg-card px-3 font-normal ring-1 ring-separator">
              <option value="skin">Skin or rash</option>
              <option value="wound">Cut or wound</option>
              <option value="swelling">Swelling or bruise</option>
              <option value="other">Something else</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-caption font-semibold text-text-primary">
            Anything else? (optional)
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="e.g. itchy for 3 days" className="h-11 rounded-md bg-card px-3 font-normal ring-1 ring-separator" />
          </label>
        </div>
      )}

      <UploadDropzone
        accept={mode === "report" ? "application/pdf,image/jpeg,image/png,image/heic" : "image/jpeg,image/png,image/heic"}
        maxSizeMb={20}
        onFile={onFile}
        hint={mode === "report" ? "PDF, JPG or PNG · up to 20 MB" : "JPG or PNG · location data is removed before upload"}
      />
      {pending && (
        <p role="status" className="text-caption text-text-secondary">
          Uploading securely…
        </p>
      )}
      {error && (
        <p role="alert" className="text-caption font-medium text-error">
          {error}
        </p>
      )}
      <p className="text-caption text-text-secondary">
        {mode === "report"
          ? "Each result is explained in plain language, compared with the range printed on the report, with questions to ask your doctor."
          : "Photo checks describe what's visible and suggest next steps. They can't diagnose — a clinician needs to examine you for that."}
      </p>
    </div>
  );
}
