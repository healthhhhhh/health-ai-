import type { ImagePurpose } from "@healthmate/shared-types";

/** What a photo can be about, with guidance for taking it. Same content on iOS (HealthMateCore `PhotoCheck`). */
export const PHOTO_PURPOSES: { id: ImagePurpose; label: string; description: string; tip: string }[] = [
  { id: "skin", label: "Skin or rash", description: "A rash, spot, mole or patch of skin", tip: "Show the whole rash or spot, not just part of it." },
  { id: "wound", label: "Cut or wound", description: "A cut, graze, burn or healing wound", tip: "Show the whole wound and a little of the skin around it." },
  { id: "swelling", label: "Swelling or bruise", description: "A swollen or bruised area", tip: "If one side is affected, a second photo of the other side helps you compare later." },
  { id: "other", label: "Something else", description: "Another visible concern", tip: "Show the area clearly with a little context around it." },
];

export const CAPTURE_TIPS = [
  "Use daylight or a bright room, and avoid flash glare.",
  "Hold the phone steady, about a hand's length away.",
  "Keep the area in focus and filling most of the frame.",
  "Leave out your face and anything else that identifies you.",
];

/** Shown before any photo is taken: a photo check is never the route for an emergency. */
export const GET_HELP_NOW =
  "If there's heavy bleeding, trouble breathing, swelling of the face, lips or throat, or you feel very unwell, call your local emergency number now — don't wait for a photo check.";

export function photoPurpose(id: string | undefined) {
  return PHOTO_PURPOSES.find((p) => p.id === id);
}

/** Link to the photo-check flow, optionally for a retake of the same kind of photo. */
export function photoCheckHref(purpose?: string | null, retake = false): string {
  const search = new URLSearchParams();
  if (purpose && photoPurpose(purpose)) search.set("purpose", purpose);
  if (retake) search.set("retake", "1");
  return search.size ? `/reports/photo-check?${search}` : "/reports/photo-check";
}
