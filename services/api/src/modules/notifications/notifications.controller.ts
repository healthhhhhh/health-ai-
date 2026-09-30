import { Body, Controller, Delete, Get, HttpCode, Inject, Injectable, Param, ParseUUIDPipe, Patch, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { AuthGuard, UserId } from "../../common/auth";
import { notFound, parseBody } from "../../common/errors";
import { RateLimit, RateLimitGuard } from "../../common/rate-limit";
import { DATABASE, type Database, type Queryable } from "../../db/database";

export type NotificationCategory = "medication" | "task" | "appointment" | "report" | "insight" | "account";

export interface NotificationRecord {
  id: string;
  category: NotificationCategory;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
  link: string | null;
  aiGenerated: boolean;
}

type Row = { id: string; category: NotificationCategory; title: string; body: string; link: string | null; ai_generated: boolean; read_at: Date | null; created_at: Date };
const COLUMNS = "id, category, title, body, link, ai_generated, read_at, created_at";
const toRecord = (r: Row): NotificationRecord => ({
  id: r.id,
  category: r.category,
  title: r.title,
  body: r.body,
  link: r.link,
  aiGenerated: r.ai_generated,
  readAt: r.read_at?.toISOString() ?? null,
  createdAt: r.created_at.toISOString(),
});

/**
 * In-app notifications. Written only by the server (e.g. "your report
 * summary is ready"), respecting the person's notification preferences.
 * Titles and bodies stay generic: health details are never put in them.
 */
@Injectable()
export class NotificationsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async list(userId: string) {
    const { rows } = await this.db.query<Row>(`SELECT ${COLUMNS} FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`, [userId]);
    const notifications = rows.map(toRecord);
    return { notifications, unreadCount: notifications.filter((n) => !n.readAt).length };
  }

  /** Creates a notification unless the person turned that category off. Returns its id, or null when skipped. */
  async notify(userId: string, input: { category: NotificationCategory; title: string; body?: string; link?: string | null; aiGenerated?: boolean }, tx: Queryable = this.db): Promise<string | null> {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO notifications (user_id, category, title, body, link, ai_generated)
       SELECT $1, $2, $3, $4, $5, $6
        WHERE COALESCE((SELECT CASE $2 WHEN 'medication' THEN medication WHEN 'task' THEN task WHEN 'appointment' THEN appointment
                                     WHEN 'report' THEN report WHEN 'insight' THEN insight ELSE account END
                          FROM notification_preferences WHERE user_id = $1), true)
       RETURNING id`,
      [userId, input.category, input.title.slice(0, 120), (input.body ?? "").slice(0, 500), input.link ?? null, input.aiGenerated ?? false],
    );
    return rows[0]?.id ?? null;
  }

  async setRead(userId: string, id: string, read: boolean) {
    const { rows } = await this.db.query<Row>(
      `UPDATE notifications SET read_at = CASE WHEN $3 THEN COALESCE(read_at, now()) ELSE NULL END WHERE id = $2 AND user_id = $1 RETURNING ${COLUMNS}`,
      [userId, id, read],
    );
    if (!rows[0]) throw notFound("Notification");
    return toRecord(rows[0]);
  }

  async readAll(userId: string) {
    await this.db.query(`UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`, [userId]);
  }

  async remove(userId: string, id: string) {
    const { rows } = await this.db.query(`DELETE FROM notifications WHERE id = $2 AND user_id = $1 RETURNING id`, [userId, id]);
    if (!rows[0]) throw notFound("Notification");
  }
}

const ReadBody = z.object({ read: z.boolean() });

@Controller("v1/notifications")
@UseGuards(AuthGuard, RateLimitGuard)
@RateLimit("notifications", 120, 60_000)
export class NotificationsController {
  constructor(@Inject(NotificationsService) private readonly notifications: NotificationsService) {}

  @Get()
  list(@UserId() userId: string) {
    return this.notifications.list(userId);
  }

  @Post("read-all")
  @HttpCode(204)
  readAll(@UserId() userId: string) {
    return this.notifications.readAll(userId);
  }

  @Patch(":id")
  setRead(@UserId() userId: string, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.notifications.setRead(userId, id, parseBody(ReadBody, body).read);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(@UserId() userId: string, @Param("id", ParseUUIDPipe) id: string) {
    return this.notifications.remove(userId, id);
  }
}
