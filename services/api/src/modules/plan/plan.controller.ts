import { Body, Controller, Get, Inject, Put, UseGuards } from "@nestjs/common";
import { AuthGuard, UserId } from "../../common/auth";
import { ApiError, parseBody } from "../../common/errors";
import { DATABASE, type Database } from "../../db/database";
import { PlanBody, type PlanCompletionInput, type PlanItemInput } from "./plan.schema";

interface PlanDocument {
  items: PlanItemInput[];
  completions: PlanCompletionInput[];
}

/**
 * The person's plan, shared by the iOS and web apps. Writes replace the whole
 * document and must name the revision they were based on; a stale revision
 * gets 409 `plan_conflict` so the client can merge and retry.
 */
@Controller("v1/plan")
@UseGuards(AuthGuard)
export class PlanController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get()
  async get(@UserId() userId: string) {
    const { rows } = await this.db.query<{ revision: number; document: PlanDocument; updated_at: Date }>(
      `SELECT revision, document, updated_at FROM plans WHERE user_id = $1`,
      [userId],
    );
    const row = rows[0];
    return row
      ? { revision: row.revision, items: row.document.items, completions: row.document.completions, updatedAt: row.updated_at.toISOString() }
      : { revision: 0, items: [], completions: [], updatedAt: null };
  }

  @Put()
  async put(@UserId() userId: string, @Body() body: unknown) {
    const input = parseBody(PlanBody, body);
    const ids = new Set(input.items.map((i) => i.id));
    if (ids.size !== input.items.length) throw new ApiError("validation_failed", "Plan items must have unique ids.", 400);
    // Completions for items that no longer exist are dropped rather than kept orphaned.
    const completions = dedupeCompletions(input.completions.filter((c) => ids.has(c.itemId)));
    const document: PlanDocument = { items: input.items, completions };

    // One atomic statement: inserts the first revision, or updates only if the
    // stored revision is still the one the client started from.
    const { rows } = await this.db.query<{ revision: number }>(
      `INSERT INTO plans (user_id, revision, document, updated_at)
       SELECT $1::uuid, $2::int + 1, $3::jsonb, now() WHERE $2::int = 0
       ON CONFLICT (user_id) DO UPDATE SET revision = plans.revision + 1, document = EXCLUDED.document, updated_at = now()
       WHERE plans.revision = $2::int
       RETURNING revision`,
      [userId, input.baseRevision, JSON.stringify(document)],
    );
    let result: number | null = rows[0]?.revision ?? null;
    if (result === null && input.baseRevision > 0) {
      const updated = await this.db.query<{ revision: number }>(
        `UPDATE plans SET revision = revision + 1, document = $3::jsonb, updated_at = now() WHERE user_id = $1 AND revision = $2 RETURNING revision`,
        [userId, input.baseRevision, JSON.stringify(document)],
      );
      result = updated.rows[0]?.revision ?? null;
    }
    if (result === null) throw new ApiError("plan_conflict", "Your plan was changed somewhere else. Reload and try again.", 409);
    return { revision: result, items: document.items, completions: document.completions };
  }
}

function dedupeCompletions(completions: PlanCompletionInput[]) {
  const seen = new Map<string, PlanCompletionInput>();
  for (const c of completions) seen.set(`${c.itemId}|${c.day}`, c);
  return [...seen.values()];
}
