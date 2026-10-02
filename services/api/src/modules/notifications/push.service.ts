import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Injectable, Logger, Optional, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { AuditService } from "../../common/audit";
import { AgeExempt, AuthGuard, UserId } from "../../common/auth";
import { ApiError, notFound, parseBody } from "../../common/errors";
import { RateLimit, RateLimitGuard } from "../../common/rate-limit";
import { CONFIG, type AppConfig } from "../../config";
import { DATABASE, type Database } from "../../db/database";
import { AgeService } from "../account/age.service";
import { JobQueue } from "../documents/job-queue";
import { decryptToken, encryptToken, inQuietHours, PUSH_PROVIDER, tokenHash, type PushMessage, type PushProvider } from "./push";

export interface PushDevice {
  id: string;
  platform: "ios";
  environment: "sandbox" | "production";
  appVersion: string | null;
  createdAt: string;
  lastRegisteredAt: string;
  /** false once the push service reported the token as no longer valid. */
  active: boolean;
}

type DeviceRow = { id: string; platform: "ios"; environment: "sandbox" | "production"; app_version: string | null; created_at: Date; last_registered_at: Date; disabled_at: Date | null };
const DEVICE_COLUMNS = "id, platform, environment, app_version, created_at, last_registered_at, disabled_at";
const toDevice = (r: DeviceRow): PushDevice => ({
  id: r.id,
  platform: r.platform,
  environment: r.environment,
  appVersion: r.app_version,
  createdAt: r.created_at.toISOString(),
  lastRegisteredAt: r.last_registered_at.toISOString(),
  active: r.disabled_at === null,
});

/** What a lock screen shows when the person hasn't allowed health details there. */
export const PRIVATE_PUSH = { title: "HealthMate", body: "You have a new notification. Open HealthMate to see it." };

export type DispatchResult = { sent: number; failed: number; invalidated: number } | { skipped: "push_disabled" | "not_found" | "already_read" | "category_off" | "quiet_hours" | "no_devices" | "age_restricted" };

/**
 * Push delivery for in-app notifications. The notification row is the source
 * of truth; a push is a best-effort copy sent after it's committed, through
 * the configured `PushProvider` (development: logged, not sent). Honours the
 * person's preferences: category switches, quiet hours (in their time zone)
 * and "show details" (off by default, so pushes say only "HealthMate").
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger("Push");

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(PUSH_PROVIDER) private readonly provider: PushProvider,
    @Inject(JobQueue) private readonly jobs: JobQueue,
    @Inject(AuditService) private readonly audit: AuditService,
    @Optional() @Inject(AgeService) private readonly age?: AgeService,
  ) {
    this.jobs.register("push-notification", async ({ userId, notificationId }) => {
      await this.dispatch(userId, notificationId);
    });
  }

  private get key(): Buffer {
    if (!this.config.pushTokenKey) throw new ApiError("not_available", "Push notifications aren't set up on this server.", HttpStatus.NOT_IMPLEMENTED);
    return this.config.pushTokenKey;
  }

  async register(userId: string, input: { platform: "ios"; token: string; environment: "sandbox" | "production"; appVersion?: string }): Promise<PushDevice> {
    const token = input.token.toLowerCase();
    const ciphertext = encryptToken(token, this.key);
    // A token identifies a device; it follows whoever signed in on it last.
    const { rows } = await this.db.query<DeviceRow>(
      `INSERT INTO push_devices (user_id, platform, environment, token_hash, token_ciphertext, app_version)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (token_hash) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, environment = EXCLUDED.environment,
         token_ciphertext = EXCLUDED.token_ciphertext, app_version = EXCLUDED.app_version, last_registered_at = now(), disabled_at = NULL, disabled_reason = NULL
       RETURNING ${DEVICE_COLUMNS}`,
      [userId, input.platform, input.environment, tokenHash(token), ciphertext, input.appVersion ?? null],
    );
    await this.audit.log("push.device_registered", userId, { platform: input.platform });
    return toDevice(rows[0]!);
  }

  async list(userId: string): Promise<PushDevice[]> {
    const { rows } = await this.db.query<DeviceRow>(`SELECT ${DEVICE_COLUMNS} FROM push_devices WHERE user_id = $1 ORDER BY last_registered_at DESC`, [userId]);
    return rows.map(toDevice);
  }

  async unregister(userId: string, id: string) {
    const { rows } = await this.db.query(`DELETE FROM push_devices WHERE id = $2 AND user_id = $1 RETURNING id`, [userId, id]);
    if (!rows[0]) throw notFound("Device");
    await this.audit.log("push.device_unregistered", userId);
  }

  /** Signing out on a device: forget its token. Idempotent. */
  async unregisterToken(userId: string, token: string) {
    const { rows } = await this.db.query(`DELETE FROM push_devices WHERE token_hash = $2 AND user_id = $1 RETURNING id`, [userId, tokenHash(token.toLowerCase())]);
    if (rows[0]) await this.audit.log("push.device_unregistered", userId);
  }

  /** Queues a push for a committed notification (ids only in the job). No-op when push is off. */
  async enqueue(userId: string, notificationId: string) {
    if (!this.provider.enabled || !this.config.pushTokenKey) return;
    await this.jobs.enqueue("push-notification", { userId, notificationId }, { jobId: `push-${notificationId}`, attempts: 1 });
  }

  async dispatch(userId: string, notificationId: string, now = new Date()): Promise<DispatchResult> {
    if (!this.provider.enabled || !this.config.pushTokenKey) return { skipped: "push_disabled" };
    type Row = { category: string; title: string; body: string; link: string | null; read_at: Date | null; enabled: boolean; show_details: boolean; quiet_hours_enabled: boolean; quiet_start: string; quiet_end: string; time_zone: string | null };
    const { rows } = await this.db.query<Row>(
      `SELECT n.category, n.title, n.body, n.link, n.read_at,
              COALESCE(CASE n.category WHEN 'medication' THEN np.medication WHEN 'task' THEN np.task WHEN 'appointment' THEN np.appointment
                                       WHEN 'report' THEN np.report WHEN 'insight' THEN np.insight ELSE np.account END, true) AS enabled,
              COALESCE(np.show_details, false) AS show_details, COALESCE(np.quiet_hours_enabled, false) AS quiet_hours_enabled,
              COALESCE(to_char(np.quiet_start, 'HH24:MI'), '22:00') AS quiet_start, COALESCE(to_char(np.quiet_end, 'HH24:MI'), '07:00') AS quiet_end,
              p.time_zone
         FROM notifications n
         LEFT JOIN notification_preferences np ON np.user_id = n.user_id
         LEFT JOIN profiles p ON p.user_id = n.user_id
        WHERE n.id = $2 AND n.user_id = $1`,
      [userId, notificationId],
    );
    const n = rows[0];
    if (!n) return { skipped: "not_found" };
    if (n.read_at) return { skipped: "already_read" };
    if (!n.enabled) return { skipped: "category_off" };
    // Accounts restricted by the age gate get no pushes (the notification stays in the app).
    if (this.age && (await this.age.eligibility(userId)) !== "eligible") return { skipped: "age_restricted" };
    // Quiet hours: the notification waits in the app; no push is sent.
    if (n.quiet_hours_enabled && inQuietHours(now, n.time_zone ?? "UTC", n.quiet_start, n.quiet_end)) return { skipped: "quiet_hours" };

    const devices = await this.db.query<{ id: string; token_ciphertext: string; environment: "sandbox" | "production" }>(
      `SELECT id, token_ciphertext, environment FROM push_devices WHERE user_id = $1 AND disabled_at IS NULL`,
      [userId],
    );
    if (!devices.rows.length) return { skipped: "no_devices" };

    const text = n.show_details ? { title: n.title, body: n.body } : PRIVATE_PUSH;
    const message: PushMessage = { notificationId, category: n.category, link: n.link, ...text };
    let sent = 0;
    let failed = 0;
    let invalidated = 0;
    for (const device of devices.rows) {
      const token = decryptToken(device.token_ciphertext, this.config.pushTokenKey);
      const outcome = token ? await this.provider.send({ deviceId: device.id, token, environment: device.environment }, message) : ({ status: "invalid_token", reason: "undecryptable" } as const);
      if (outcome.status === "sent") sent += 1;
      else if (outcome.status === "invalid_token") {
        invalidated += 1;
        // The app registers again on its next launch, which re-enables the device.
        await this.db.query(`UPDATE push_devices SET disabled_at = now(), disabled_reason = $2 WHERE id = $1`, [device.id, outcome.reason.slice(0, 64)]);
      } else {
        failed += 1;
        this.logger.warn(`push to device ${device.id} failed (${outcome.reason})`);
      }
    }
    return { sent, failed, invalidated };
  }
}

const RegisterDeviceBody = z.object({
  platform: z.literal("ios"),
  /** APNs device token, hex. */
  token: z.string().regex(/^[0-9a-fA-F]{64,200}$/),
  environment: z.enum(["sandbox", "production"]),
  appVersion: z.string().trim().max(32).optional(),
});
const UnregisterDeviceBody = z.object({ token: z.string().regex(/^[0-9a-fA-F]{64,200}$/) });

/** Devices that receive push notifications for the signed-in person. Tokens are write-only. */
@Controller("v1/me/devices")
@UseGuards(AuthGuard, RateLimitGuard)
export class DevicesController {
  constructor(@Inject(PushService) private readonly push: PushService) {}

  @Get()
  @RateLimit("devices-read", 60, 60_000)
  async list(@UserId() userId: string) {
    return { devices: await this.push.list(userId) };
  }

  @Post()
  @RateLimit("devices-write", 20, 60_000)
  register(@UserId() userId: string, @Body() body: unknown) {
    return this.push.register(userId, parseBody(RegisterDeviceBody, body));
  }

  /** Sign-out on a device: the app sends its own token. Allowed whatever the age state. */
  @Delete()
  @HttpCode(204)
  @AgeExempt()
  @RateLimit("devices-write", 20, 60_000)
  async unregisterToken(@UserId() userId: string, @Body() body: unknown) {
    await this.push.unregisterToken(userId, parseBody(UnregisterDeviceBody, body).token);
  }

  @Delete(":id")
  @HttpCode(204)
  @AgeExempt()
  @RateLimit("devices-write", 20, 60_000)
  async unregister(@UserId() userId: string, @Param("id", ParseUUIDPipe) id: string) {
    await this.push.unregister(userId, id);
  }
}
