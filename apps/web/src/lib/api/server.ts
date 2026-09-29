import type { ApiErrorBody } from "@healthmate/shared-types";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { parseControls, PREVIEW_CONTROLS_COOKIE } from "../preview/controls";
import { isPreviewMode } from "../preview/mode";
import { apiBaseUrl } from "./config";
import { ACCESS_COOKIE } from "./session";

/** An error from the HealthMate API with a message that is safe to show. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const NETWORK_MESSAGE = "We couldn't reach HealthMate. Please try again in a moment.";

/**
 * Calls the API as the signed-in person (server components, actions and route
 * handlers only). The proxy keeps the access token fresh; a 401 here means the
 * session has ended, so the person is sent to sign in.
 */
export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/sign-in");
  const res = await rawApi(path, init, token);
  if (res.status === 401) redirect("/sign-in?expired=1");
  return parse<T>(res);
}

/** Unauthenticated call (sign-in, meta). */
export async function publicApi<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  return parse<T>(await rawApi(path, init));
}

async function rawApi(path: string, init: RequestInit & { json?: unknown }, token?: string) {
  const { json, headers, ...rest } = init;
  if (isPreviewMode()) {
    // Phase 1: answered locally from the sample account — no backend.
    const controls = parseControls((await cookies()).get(PREVIEW_CONTROLS_COOKIE)?.value);
    const { previewFetch } = await import("../preview/router");
    try {
      return await previewFetch(path, rest.method ?? "GET", json, token, controls);
    } catch {
      throw new ApiError(NETWORK_MESSAGE, 0, "network");
    }
  }
  try {
    return await fetch(`${apiBaseUrl()}/${path.replace(/^\//, "")}`, {
      ...rest,
      body: json === undefined ? rest.body : JSON.stringify(json),
      headers: {
        Accept: "application/json",
        ...(json === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      cache: "no-store",
    });
  } catch {
    throw new ApiError(NETWORK_MESSAGE, 0, "network");
  }
}

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  if (!res.ok) {
    const error = (body as ApiErrorBody | undefined)?.error;
    throw new ApiError(error?.message ?? "Something went wrong. Please try again.", res.status, error?.code ?? "unknown");
  }
  return body as T;
}

/** Turns any thrown error into a message that is safe to show the person. */
export function errorMessage(error: unknown) {
  return error instanceof ApiError ? error.message : "Something went wrong. Please try again.";
}
