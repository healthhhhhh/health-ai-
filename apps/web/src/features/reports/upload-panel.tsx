"use client";

import { Camera, ChevronRight, FileText, Image as ImageIcon, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { IconBadge } from "@/components/ui/icon-badge";
import { StepProgress } from "@/components/ui/step-progress";
import { UploadDropzone } from "@/components/ui/upload-dropzone";
import { photoCheckHref } from "@/lib/photo-check";
import { byteSize, PROCESSING_STEPS } from "@/lib/reports";
import { cleanImage, uploadDocument } from "./upload-client";

/** Upload a medical report: choose a file, confirm it, then follow the upload's progress. */
export function UploadPanel() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const preview = useMemo(() => (file && file.type.startsWith("image/") ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  const choose = (next: File | null) => {
    setFile(next);
    setError(null);
  };

  const send = () =>
    start(async () => {
      if (!file) return;
      setError(null);
      if (!navigator.onLine) {
        setError("You're offline. Connect to the internet and try again — your file is still selected.");
        return;
      }
      try {
        const form = new FormData();
        form.set("file", file.type === "application/pdf" ? file : await cleanImage(file));
        form.set("kind", "report");
        router.push(`/reports/${await uploadDocument(form)}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "The upload didn't complete. Please try again.");
      }
    });

  return (
    <div className="flex flex-col gap-4">
      {!file ? (
        <UploadDropzone accept="application/pdf,image/jpeg,image/png,image/heic" maxSizeMb={20} onFile={choose} hint="PDF, JPG or PNG" />
      ) : (
        <section aria-label="Selected file" className="flex flex-col gap-4 rounded-lg bg-card-muted p-4 ring-1 ring-separator">
          <div className="flex items-center gap-3">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element -- a local, not-yet-uploaded file
              <img src={preview} alt="" className="size-14 shrink-0 rounded-md object-cover" />
            ) : (
              <IconBadge icon={file.type === "application/pdf" ? <FileText /> : <ImageIcon />} tone="blue" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-body font-semibold text-text-primary">{file.name}</p>
              <p className="text-caption text-text-secondary">{byteSize(file.size)} · Medical report</p>
            </div>
          </div>
          {pending ? (
            <StepProgress steps={PROCESSING_STEPS.map((label, i) => ({ label: i === 0 ? "Uploading securely" : label }))} current={0} label="Upload progress" />
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button onClick={send}>{error ? "Try again" : "Upload and summarise"}</Button>
              <Button variant="ghost" onClick={() => choose(null)}>
                <RotateCcw aria-hidden /> Choose another file
              </Button>
            </div>
          )}
        </section>
      )}
      {error && (
        <p role="alert" className="rounded-md bg-error-soft p-3 text-caption font-medium text-error">
          {error}
        </p>
      )}
      <p className="text-caption text-text-secondary">
        Each result is explained in plain language, compared with the range printed on the report, with questions to ask your doctor.
      </p>
      <Link href={photoCheckHref()} className="flex items-center gap-3 rounded-lg p-3 ring-1 ring-separator hover:bg-card-muted">
        <IconBadge icon={<Camera />} tone="purple" size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block text-body font-semibold text-text-primary">Check a photo instead</span>
          <span className="block text-caption text-text-secondary">A skin concern, a cut or wound, or swelling</span>
        </span>
        <ChevronRight aria-hidden className="size-4 text-text-muted" />
      </Link>
    </div>
  );
}
