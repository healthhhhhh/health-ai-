/** Browser-side upload helpers shared by the report upload and the photo check. */

/** Re-encodes a photo as JPEG in the browser, which also drops location and other metadata. */
export async function cleanImage(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) throw new Error("We couldn't read that photo. Try another one.");
  return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
}

export async function uploadDocument(form: FormData): Promise<string> {
  let res: Response;
  try {
    res = await fetch("/reports/upload", { method: "POST", body: form });
  } catch {
    throw new Error("We couldn't reach HealthMate. Check your connection and try again.");
  }
  const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
  if (!res.ok || !body.id) throw new Error(body.error ?? "The upload didn't complete. Please try again.");
  return body.id;
}
