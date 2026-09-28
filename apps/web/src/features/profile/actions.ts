"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { api, errorMessage } from "@/lib/api/server";

export interface FormState {
  error?: string;
  ok?: number;
}

async function run(work: () => Promise<unknown>): Promise<FormState> {
  try {
    await work();
  } catch (error) {
    unstable_rethrow(error);
    return { error: errorMessage(error) };
  }
  revalidatePath("/profile");
  return { ok: Date.now() };
}

const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim();

export async function updateDetails(_prev: FormState, form: FormData): Promise<FormState> {
  const firstName = text(form, "firstName");
  if (!firstName) return { error: "Enter your first name." };
  const dateOfBirth = text(form, "dateOfBirth") || null;
  return run(() => api("me/profile", { method: "PATCH", json: { firstName, lastName: text(form, "lastName"), dateOfBirth } }));
}

export async function addCondition(_prev: FormState, form: FormData): Promise<FormState> {
  const name = text(form, "name");
  if (!name) return { error: "Enter a condition." };
  return run(() => api("me/conditions", { method: "POST", json: { name, source: "user_reported" } }));
}

export async function addAllergy(_prev: FormState, form: FormData): Promise<FormState> {
  const substance = text(form, "substance");
  if (!substance) return { error: "Enter what you're allergic to." };
  return run(() => api("me/allergies", { method: "POST", json: { substance, reaction: text(form, "reaction") || null, source: "user_reported" } }));
}

/** The instruction is stored word for word; only surrounding whitespace is removed. */
export async function addMedication(_prev: FormState, form: FormData): Promise<FormState> {
  const name = text(form, "name");
  const instruction = text(form, "instruction");
  if (!name) return { error: "Enter the medication name." };
  if (!instruction) return { error: "Copy the instructions exactly as written on your prescription or label." };
  const source = form.get("fromClinician") === "on" ? "clinician_provided" : "user_reported";
  return run(() => api("me/medications", { method: "POST", json: { name, instruction, source } }));
}

export async function removeProfileItem(collection: "conditions" | "allergies" | "medications", id: string): Promise<FormState> {
  if (!["conditions", "allergies", "medications"].includes(collection)) return { error: "Unknown item." };
  return run(() => api(`me/${collection}/${encodeURIComponent(id)}`, { method: "DELETE" }));
}

export async function addMemory(_prev: FormState, form: FormData): Promise<FormState> {
  const fact = text(form, "fact");
  if (!fact) return { error: "Write something to remember." };
  return run(() => api("memories", { method: "POST", json: { fact: fact.slice(0, 500), status: "user_reported" } }));
}

/** Editing or confirming a memory marks it as confirmed by the person. */
export async function confirmMemory(id: string, fact?: string): Promise<FormState> {
  return run(() => api(`memories/${encodeURIComponent(id)}`, { method: "PATCH", json: fact ? { fact: fact.slice(0, 500) } : { confirm: true } }));
}

export async function deleteMemory(id: string): Promise<FormState> {
  return run(() => api(`memories/${encodeURIComponent(id)}`, { method: "DELETE" }));
}
