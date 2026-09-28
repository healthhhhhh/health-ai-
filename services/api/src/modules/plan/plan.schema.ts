import { z } from "zod";

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const RepeatRule = z.discriminatedUnion("type", [
  z.object({ type: z.literal("daily") }),
  z.object({ type: z.literal("weekdays"), days: z.array(z.number().int().min(1).max(7)).min(1).max(7) }),
  z.object({ type: z.literal("once"), day: Day }),
]);

/**
 * One plan item. For medications, `instruction` is the clinician's or label's
 * wording exactly as the person entered it — never generated or changed.
 * Sample (demo) items never leave the device, so they are rejected here.
 */
export const PlanItem = z
  .object({
    id: z.string().uuid(),
    title: z.string().trim().min(1).max(120),
    notes: z.string().max(500).nullable(),
    kind: z.enum(["task", "medication", "habit"]),
    time: Time,
    repeat: RepeatRule,
    reminderEnabled: z.boolean(),
    source: z.enum(["user_reported", "clinician_provided"]),
    instruction: z.string().max(1000).nullable(),
    startDay: Day,
    endDay: Day.nullable(),
    createdAt: z.string().datetime({ offset: true }),
  })
  .refine((item) => item.kind !== "medication" || (item.instruction !== null && item.instruction.trim().length > 0), {
    message: "Medications need the instruction exactly as written by the clinician or on the label.",
    path: ["instruction"],
  });

export const PlanCompletion = z.object({
  itemId: z.string().uuid(),
  day: Day,
  completedAt: z.string().datetime({ offset: true }),
});

export const PlanBody = z.object({
  baseRevision: z.number().int().min(0),
  items: z.array(PlanItem).max(300),
  completions: z.array(PlanCompletion).max(20_000),
});

export type PlanItemInput = z.infer<typeof PlanItem>;
export type PlanCompletionInput = z.infer<typeof PlanCompletion>;
