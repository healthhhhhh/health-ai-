import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { ApiError } from "../../common/errors";
import { DATABASE, type Database } from "../../db/database";
import { AI_PROVIDER, AiDeclinedError, AiInvalidOutputError, AiUnavailableError, type AiProvider, type AiRequest, type AiResult } from "./ai.types";

/**
 * The single entry point for model calls: provider routing, usage/cost
 * tracking (token counts only) and mapping failures to honest errors.
 */
@Injectable()
export class AiGateway {
  constructor(
    @Inject(AI_PROVIDER) private readonly provider: AiProvider,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  get available() {
    return this.provider.available;
  }

  async generate<T>(request: AiRequest<T>): Promise<AiResult<T>> {
    try {
      const result = await this.provider.generate(request);
      await this.record(request, result.model, result.usage.inputTokens, result.usage.outputTokens, "ok");
      return result;
    } catch (error) {
      await this.record(request, this.provider.name, 0, 0, error instanceof Error ? error.name : "error");
      throw error;
    }
  }

  /** Converts AI failures into API errors that say plainly no answer was produced. */
  static toApiError(error: unknown): unknown {
    if (error instanceof AiUnavailableError) {
      return new ApiError("ai_unavailable", "The AI response couldn't be generated right now. Nothing was analysed — please try again later.", HttpStatus.SERVICE_UNAVAILABLE);
    }
    if (error instanceof AiDeclinedError) {
      return new ApiError("ai_declined", "The AI couldn't help with this request. If you're worried about your health, please contact a clinician.", HttpStatus.UNPROCESSABLE_ENTITY);
    }
    if (error instanceof AiInvalidOutputError) {
      return new ApiError("ai_invalid_output", "The AI response couldn't be generated reliably. Please try again.", HttpStatus.BAD_GATEWAY);
    }
    return error;
  }

  private async record(request: AiRequest<unknown>, model: string, input: number, output: number, outcome: string) {
    await this.db
      .query(`INSERT INTO ai_usage (user_id, feature, model, input_tokens, output_tokens, outcome) VALUES ($1, $2, $3, $4, $5, $6)`, [
        request.userId ?? null,
        request.feature,
        model,
        input,
        output,
        outcome,
      ])
      .catch(() => undefined);
  }
}
