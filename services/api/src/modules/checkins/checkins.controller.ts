import { Body, Controller, Get, Inject, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { AuthGuard, UserId } from "../../common/auth";
import { parseBody } from "../../common/errors";
import { DATABASE, type Database } from "../../db/database";

const MoodBody = z.object({ mood: z.enum(["great", "good", "okay", "low", "unwell"]) });
type Row = { mood: string; recorded_at: Date };
const toCheckIn = (r: Row) => ({ mood: r.mood, recordedAt: r.recorded_at.toISOString() });

/** Mood check-ins. Only the caller's own rows are ever read or written. */
@Controller("v1/check-ins")
@UseGuards(AuthGuard)
export class CheckInsController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Post("mood")
  async recordMood(@UserId() userId: string, @Body() body: unknown) {
    const { mood } = parseBody(MoodBody, body);
    const { rows } = await this.db.query<Row>(`INSERT INTO mood_checkins (user_id, mood) VALUES ($1, $2) RETURNING mood, recorded_at`, [userId, mood]);
    return toCheckIn(rows[0]!);
  }

  /** The most recent check-in, or null. Clients decide whether it is "today" in the person's time zone. */
  @Get("mood/latest")
  async latestMood(@UserId() userId: string) {
    const { rows } = await this.db.query<Row>(`SELECT mood, recorded_at FROM mood_checkins WHERE user_id = $1 ORDER BY recorded_at DESC LIMIT 1`, [userId]);
    return { checkIn: rows[0] ? toCheckIn(rows[0]) : null };
  }
}
