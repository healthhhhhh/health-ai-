"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { api, errorMessage } from "@/lib/api/server";

export async function deleteDocument(id: string): Promise<{ error?: string }> {
  try {
    await api(`documents/${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch (error) {
    unstable_rethrow(error);
    return { error: errorMessage(error) };
  }
  revalidatePath("/reports");
  return {};
}
