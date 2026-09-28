import { Body, Controller, Get, Inject, Injectable, Put, UseGuards } from "@nestjs/common";
import { AuthGuard, UserId } from "../../common/auth";
import { ApiError, parseBody } from "../../common/errors";
import { RateLimit, RateLimitGuard } from "../../common/rate-limit";
import { DATABASE, type Database, type Queryable } from "../../db/database";
import { PlanBody, type PlanCompletionInput, type PlanItemInput } from "./plan.schema";

type ItemRow = {
  id: string;
  title: string;
  notes: string | null;
  kind: PlanItemInput["kind"];
  time_of_day: string;
  repeat_type: "daily" | "weekdays" | "once";
  repeat_days: number[] | null;
  repeat_day: string | null;
  reminder_enabled: boolean;
  source: PlanItemInput["source"];
  instruction: string | null;
  start_day: string;
  end_day: string | null;
  created_at: Date;
};

const conflict = () => new ApiError("plan_conflict", "Your plan was changed somewhere else. Reload and try again.", 409);

/**
 * The plan is stored normalised (plan_items, task_completions, reminders);
 * `plans` keeps only the revision used for optimistic concurrency, so the
 * API contract (whole-plan GET/PUT with a base revision) is unchanged.
 */
@Injectable()
export class PlanService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async get(userId: string) {
    const { rows } = await this.db.query<{ revision: number; updated_at: Date }>(`SELECT revision, updated_at FROM plans WHERE user_id = $1`, [userId]);
    if (!rows[0]) return { revision: 0, items: [], completions: [], updatedAt: null };
    const { items, completions } = await this.read(this.db, userId);
    return { revision: rows[0].revision, items, completions, updatedAt: rows[0].updated_at.toISOString() };
  }

  async put(userId: string, input: { baseRevision: number; items: PlanItemInput[]; completions: PlanCompletionInput[] }) {
    const ids = new Set(input.items.map((i) => i.id));
    if (ids.size !== input.items.length) throw new ApiError("validation_failed", "Plan items must have unique ids.", 400);
    // Completions for items that no longer exist are dropped rather than kept orphaned.
    const completions = dedupeCompletions(input.completions.filter((c) => ids.has(c.itemId)));

    return this.db.transaction(async (tx) => {
      const revision = await this.bumpRevision(tx, userId, input.baseRevision);
      await tx.query(`DELETE FROM plan_items WHERE user_id = $1 AND NOT (id = ANY($2::uuid[]))`, [userId, [...ids]]);
      if (input.items.length) {
        const saved = await tx.query(
          `INSERT INTO plan_items (id, user_id, title, notes, kind, time_of_day, repeat_type, repeat_days, repeat_day, reminder_enabled, source, instruction, start_day, end_day, position, created_at)
           SELECT x.id, $1, x.title, x.notes, x.kind, x.time::time, x.repeat_type, x.repeat_days, x.repeat_day, x.reminder_enabled, x.source, x.instruction, x.start_day, x.end_day, x.position, x.created_at
             FROM jsonb_to_recordset($2::jsonb) AS x(id uuid, title text, notes text, kind text, time text, repeat_type text, repeat_days smallint[], repeat_day date,
                                                    reminder_enabled boolean, source text, instruction text, start_day date, end_day date, position int, created_at timestamptz)
           ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, notes = EXCLUDED.notes, kind = EXCLUDED.kind, time_of_day = EXCLUDED.time_of_day,
             repeat_type = EXCLUDED.repeat_type, repeat_days = EXCLUDED.repeat_days, repeat_day = EXCLUDED.repeat_day, reminder_enabled = EXCLUDED.reminder_enabled,
             source = EXCLUDED.source, instruction = EXCLUDED.instruction, start_day = EXCLUDED.start_day, end_day = EXCLUDED.end_day, position = EXCLUDED.position
             -- Ids come from the client: never let one account's write touch another's row.
             WHERE plan_items.user_id = EXCLUDED.user_id
           RETURNING id`,
          [userId, JSON.stringify(input.items.map(toWire))],
        );
        if (saved.rows.length !== input.items.length) throw new ApiError("validation_failed", "One of these plan item ids can't be used.", 400);
      }
      await tx.query(`DELETE FROM task_completions WHERE user_id = $1`, [userId]);
      if (completions.length) {
        await tx.query(
          `INSERT INTO task_completions (user_id, plan_item_id, day, completed_at)
           SELECT $1, x.item_id, x.day, x.completed_at FROM jsonb_to_recordset($2::jsonb) AS x(item_id uuid, day date, completed_at timestamptz)`,
          [userId, JSON.stringify(completions.map((c) => ({ item_id: c.itemId, day: c.day, completed_at: c.completedAt })))],
        );
      }
      // Device-scheduled reminders mirror each item's time and toggle.
      await tx.query(
        `INSERT INTO reminders (user_id, plan_item_id, time_of_day, enabled)
         SELECT user_id, id, time_of_day, reminder_enabled FROM plan_items WHERE user_id = $1
         ON CONFLICT (plan_item_id) DO UPDATE SET time_of_day = EXCLUDED.time_of_day, enabled = EXCLUDED.enabled`,
        [userId],
      );
      const stored = await this.read(tx, userId);
      return { revision, items: stored.items, completions: stored.completions };
    });
  }

  /** Reminders for the person's plan items (scheduled on the device today). */
  async reminders(userId: string) {
    const { rows } = await this.db.query<{ id: string; plan_item_id: string; title: string; time_of_day: string; enabled: boolean; channel: string }>(
      `SELECT r.id, r.plan_item_id, i.title, to_char(r.time_of_day, 'HH24:MI') AS time_of_day, r.enabled, r.channel
         FROM reminders r JOIN plan_items i ON i.id = r.plan_item_id
        WHERE r.user_id = $1 ORDER BY r.time_of_day, i.position`,
      [userId],
    );
    return rows.map((r) => ({ id: r.id, planItemId: r.plan_item_id, title: r.title, time: r.time_of_day, enabled: r.enabled, channel: r.channel }));
  }

  /** Inserts the first revision, or advances it only if it's still the one the client started from. */
  private async bumpRevision(tx: Queryable, userId: string, baseRevision: number): Promise<number> {
    if (baseRevision === 0) {
      const { rows } = await tx.query<{ revision: number }>(
        `INSERT INTO plans (user_id, revision, updated_at) VALUES ($1, 1, now()) ON CONFLICT (user_id) DO NOTHING RETURNING revision`,
        [userId],
      );
      if (rows[0]) return rows[0].revision;
      // A plan row can exist at revision 0 only if created elsewhere; treat as a conflict otherwise.
    }
    const { rows } = await tx.query<{ revision: number }>(
      `UPDATE plans SET revision = revision + 1, document = NULL, updated_at = now() WHERE user_id = $1 AND revision = $2 RETURNING revision`,
      [userId, baseRevision],
    );
    if (!rows[0]) throw conflict();
    return rows[0].revision;
  }

  private async read(q: Queryable, userId: string) {
    const [items, completions] = await Promise.all([
      q.query<ItemRow>(
        `SELECT id, title, notes, kind, to_char(time_of_day, 'HH24:MI') AS time_of_day, repeat_type, repeat_days, repeat_day::text AS repeat_day, reminder_enabled,
                source, instruction, start_day::text AS start_day, end_day::text AS end_day, created_at
           FROM plan_items WHERE user_id = $1 ORDER BY position, created_at`,
        [userId],
      ),
      q.query<{ plan_item_id: string; day: string; completed_at: Date }>(
        `SELECT plan_item_id, day::text AS day, completed_at FROM task_completions WHERE user_id = $1 ORDER BY day, plan_item_id`,
        [userId],
      ),
    ]);
    return {
      items: items.rows.map(fromRow),
      completions: completions.rows.map((c) => ({ itemId: c.plan_item_id, day: c.day, completedAt: c.completed_at.toISOString() })),
    };
  }
}

/**
 * The person's plan, shared by the iOS and web apps. Writes replace the whole
 * plan and must name the revision they were based on; a stale revision gets
 * 409 `plan_conflict` so the client can merge and retry.
 */
@Controller("v1/plan")
@UseGuards(AuthGuard, RateLimitGuard)
export class PlanController {
  constructor(@Inject(PlanService) private readonly plans: PlanService) {}

  @Get()
  @RateLimit("plan-read", 120, 60_000)
  get(@UserId() userId: string) {
    return this.plans.get(userId);
  }

  @Put()
  @RateLimit("plan-write", 60, 60_000)
  put(@UserId() userId: string, @Body() body: unknown) {
    return this.plans.put(userId, parseBody(PlanBody, body));
  }
}

@Controller("v1/reminders")
@UseGuards(AuthGuard, RateLimitGuard)
export class RemindersController {
  constructor(@Inject(PlanService) private readonly plans: PlanService) {}

  @Get()
  @RateLimit("reminders-read", 120, 60_000)
  list(@UserId() userId: string) {
    return this.plans.reminders(userId);
  }
}

function toWire(item: PlanItemInput, position: number) {
  return {
    id: item.id,
    title: item.title,
    notes: item.notes,
    kind: item.kind,
    time: item.time,
    repeat_type: item.repeat.type,
    repeat_days: item.repeat.type === "weekdays" ? [...new Set(item.repeat.days)].sort() : null,
    repeat_day: item.repeat.type === "once" ? item.repeat.day : null,
    reminder_enabled: item.reminderEnabled,
    source: item.source,
    // Stored exactly as entered — never trimmed, reworded or generated.
    instruction: item.instruction,
    start_day: item.startDay,
    end_day: item.endDay,
    position,
    created_at: item.createdAt,
  };
}

function fromRow(r: ItemRow): PlanItemInput {
  const repeat: PlanItemInput["repeat"] =
    r.repeat_type === "weekdays" ? { type: "weekdays", days: (r.repeat_days ?? []).map(Number) } : r.repeat_type === "once" ? { type: "once", day: r.repeat_day! } : { type: "daily" };
  return {
    id: r.id,
    title: r.title,
    notes: r.notes,
    kind: r.kind,
    time: r.time_of_day,
    repeat,
    reminderEnabled: r.reminder_enabled,
    source: r.source,
    instruction: r.instruction,
    startDay: r.start_day,
    endDay: r.end_day,
    createdAt: r.created_at.toISOString(),
  };
}

function dedupeCompletions(completions: PlanCompletionInput[]) {
  const seen = new Map<string, PlanCompletionInput>();
  for (const c of completions) seen.set(`${c.itemId}|${c.day}`, c);
  return [...seen.values()];
}
