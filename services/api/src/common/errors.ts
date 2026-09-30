import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import type { Response } from "express";
import type { ZodType } from "zod";

/** Structured error codes returned to clients as `{ error: { code, message } }`. */
export type ErrorCode =
  | "bad_request"
  | "validation_failed"
  | "unauthorized"
  | "email_not_confirmed"
  | "invalid_token"
  | "not_available"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "plan_conflict"
  | "rate_limited"
  | "payload_too_large"
  | "unsupported_media_type"
  | "ai_unavailable"
  | "ai_declined"
  | "ai_invalid_output"
  | "internal";

export class ApiError extends HttpException {
  constructor(
    readonly code: ErrorCode,
    message: string,
    status: HttpStatus,
  ) {
    super({ error: { code, message } }, status);
  }
}

export const notFound = (what = "Resource") => new ApiError("not_found", `${what} not found.`, HttpStatus.NOT_FOUND);
export const unauthorized = (message = "Sign in again to continue.") => new ApiError("unauthorized", message, HttpStatus.UNAUTHORIZED);

/**
 * Parses a request body with zod. Error messages name the fields that failed
 * but never echo submitted values (which may contain health information).
 */
export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((i) => i.path.join(".") || "body"))].join(", ");
    throw new ApiError("validation_failed", `Check these fields: ${fields}.`, HttpStatus.BAD_REQUEST);
  }
  return result.data;
}

/** Maps every error to the structured shape; unknown errors never leak details. */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger("Errors");

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (exception instanceof ApiError) {
      res.status(exception.getStatus()).json(exception.getResponse());
      return;
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code: ErrorCode =
        status === 404 ? "not_found" : status === 413 ? "payload_too_large" : status === 401 ? "unauthorized" : status === 429 ? "rate_limited" : "bad_request";
      res.status(status).json({ error: { code, message: status === 404 ? "Not found." : "The request couldn't be processed." } });
      return;
    }
    // A database constraint caught invalid input the schema allowed (e.g. an end date before a start date).
    const pgCode = (exception as { code?: unknown } | null)?.code;
    if (pgCode === "23514" || pgCode === "22007" || pgCode === "22008") {
      res.status(HttpStatus.BAD_REQUEST).json({ error: { code: "validation_failed", message: "Those details don't fit together — check the dates and try again." } });
      return;
    }
    // Log the error type and stack only — never request bodies (health data).
    this.logger.error(exception instanceof Error ? `${exception.name}: ${exception.message}` : "Unknown error", exception instanceof Error ? exception.stack : undefined);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: { code: "internal", message: "Something went wrong on our side. Please try again." } });
  }
}
