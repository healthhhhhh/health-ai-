"use client";

import { Upload } from "lucide-react";
import { useId, useRef, useState } from "react";
import { cn } from "@/lib/cn";

interface UploadDropzoneProps {
  accept: string;
  maxSizeMb: number;
  onFile: (file: File) => void;
  hint?: string;
}

/** Drag-and-drop or click-to-browse file picker with client-side type/size validation. */
export function UploadDropzone({ accept, maxSizeMb, onFile, hint = "PDF, JPG, PNG or HEIC" }: UploadDropzoneProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handle = (file: File | undefined) => {
    if (!file) return;
    const allowed = accept.split(",").map((s) => s.trim().toLowerCase());
    const ext = "." + (file.name.split(".").pop() ?? "").toLowerCase();
    if (!allowed.includes(ext) && !allowed.includes(file.type.toLowerCase())) {
      setError(`That file type isn't supported. Use ${hint}.`);
      return;
    }
    if (file.size > maxSizeMb * 1024 * 1024) {
      setError(`That file is larger than ${maxSizeMb} MB.`);
      return;
    }
    setError(null);
    onFile(file);
  };

  return (
    <div>
      <label
        htmlFor={inputId}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handle(e.dataTransfer.files[0]);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-primary-tint bg-primary-soft/50 px-6 py-10 text-center transition-colors hover:border-primary",
          dragging && "border-primary bg-primary-soft",
        )}
      >
        <span className="inline-flex size-12 items-center justify-center rounded-full bg-card text-primary shadow-card">
          <Upload aria-hidden className="size-5" />
        </span>
        <span className="text-card-title text-text-primary">Drop a file or browse</span>
        <span className="text-caption text-text-secondary">
          {hint} · up to {maxSizeMb} MB
        </span>
      </label>
      <input ref={inputRef} id={inputId} type="file" accept={accept} className="sr-only" onChange={(e) => handle(e.target.files?.[0])} />
      {error && (
        <p role="alert" className="mt-2 text-caption font-medium text-error">
          {error}
        </p>
      )}
    </div>
  );
}
