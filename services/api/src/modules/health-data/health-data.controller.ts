import { Body, Controller, Delete, Get, HttpStatus, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { AuthGuard, UserId } from "../../common/auth";
import { ApiError, parseBody } from "../../common/errors";
import { RateLimit, RateLimitGuard } from "../../common/rate-limit";
import { AccountService } from "../account/account.service";
import { ProfileService } from "../profile/profile.service";
import { BOUNDS, HealthDataService, MEASUREMENT_UNITS, type MeasurementKind } from "./health-data.service";

const KINDS = Object.keys(MEASUREMENT_UNITS) as [MeasurementKind, ...MeasurementKind[]];

const Measurement = z
  .object({
    kind: z.enum(KINDS),
    value: z.number().finite(),
    recordedAt: z.string().datetime({ offset: true }),
    source: z.enum(["apple_health", "user_entered"]),
    sourceDevice: z.string().max(120).nullable().optional(),
    externalId: z.string().max(120).nullable().optional(),
  })
  .refine((m) => m.value >= BOUNDS[m.kind][0] && m.value <= BOUNDS[m.kind][1], { message: "value out of range", path: ["value"] })
  // Apple Health data arrives as whole days (PUT /v1/health-data/daily, or an older app's "apple_health:<kind>:<day>" ids):
  // summing raw samples here would double-count iPhone + Apple Watch.
  .refine((m) => m.source !== "apple_health" || new RegExp(`^apple_health:${m.kind}:\\d{4}-\\d{2}-\\d{2}$`).test(m.externalId ?? ""), {
    message: "send Apple Health data as daily records",
    path: ["externalId"],
  });

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => !Number.isNaN(Date.parse(d)), "Invalid date");
const deviceId = z.string().regex(/^[A-Za-z0-9-]{8,64}$/);
const errorCode = z.string().regex(/^[a-z_]{1,40}$/);

const ConnectBody = z.object({
  deviceName: z.string().trim().max(120).nullable().optional(),
  deviceId: deviceId.nullable().optional(),
  scopes: z.array(z.enum(KINDS)).max(KINDS.length),
  /** How much history the person chose to import (days). */
  historyDays: z.number().int().min(1).max(3660).nullable().optional(),
});

/** One day of one metric as HealthKit computed it on the iPhone. */
const DailyRecordBody = z
  .object({
    day,
    kind: z.enum(KINDS),
    value: z.number().finite(),
    min: z.number().finite().nullable().optional(),
    max: z.number().finite().nullable().optional(),
    sampleCount: z.number().int().min(0).max(1_000_000).nullable().optional(),
    isComplete: z.boolean(),
    computedAt: z.string().datetime({ offset: true }),
  })
  .refine((r) => r.value >= BOUNDS[r.kind][0] && r.value <= BOUNDS[r.kind][1], { message: "value out of range", path: ["value"] })
  .refine((r) => r.min == null || r.max == null || r.min <= r.max, { message: "min above max", path: ["min"] })
  // A day can't be computed before it starts; allow a day of clock/time-zone slack.
  .refine((r) => Date.parse(`${r.day}T00:00:00Z`) <= Date.parse(r.computedAt) + 86_400_000, { message: "computed before the day", path: ["computedAt"] });

const DailyUploadBody = z.object({
  timeZone: z.string().min(1).max(64).refine((tz) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Unknown time zone"),
  sourceDevice: z.string().trim().max(120).nullable().optional(),
  syncRunId: z.string().uuid().nullable().optional(),
  records: z.array(DailyRecordBody).min(1).max(500),
});

const StartRunBody = z.object({ kind: z.enum(["initial_import", "incremental", "manual"]), deviceId: deviceId.nullable().optional() });
const FinishRunBody = z
  .object({
    status: z.enum(["succeeded", "partial", "failed"]),
    daysSent: z.number().int().min(0).max(100_000),
    recordsUpserted: z.number().int().min(0).max(1_000_000),
    oldestDay: day.nullable().optional(),
    newestDay: day.nullable().optional(),
    errorCode: errorCode.nullable().optional(),
    /** The chosen history has been fully imported. */
    historyComplete: z.boolean().optional(),
  })
  .refine((r) => !r.oldestDay || !r.newestDay || r.oldestDay <= r.newestDay, { message: "oldest after newest", path: ["oldestDay"] });

const IngestBody = z.object({ measurements: z.array(Measurement).min(1).max(500) });

@Controller("v1/health-data")
@UseGuards(AuthGuard, RateLimitGuard)
@RateLimit("health-data", 120, 60_000)
export class HealthDataController {
  constructor(
    @Inject(HealthDataService) private readonly data: HealthDataService,
    @Inject(ProfileService) private readonly profiles: ProfileService,
    @Inject(AccountService) private readonly account: AccountService,
  ) {}

  @Post("measurements")
  @RateLimit("health-ingest", 60, 60 * 60_000)
  async ingest(@UserId() userId: string, @Body() body: unknown) {
    const { measurements } = parseBody(IngestBody, body);
    if (measurements.some((m) => m.source === "apple_health")) await this.account.requireConsent(userId, "health_data_sync");
    return this.data.ingest(userId, measurements);
  }

  /** Apple Health daily values computed on the iPhone (idempotent; the newest computation wins). */
  @Put("daily")
  @RateLimit("health-daily", 120, 60 * 60_000)
  async upsertDaily(@UserId() userId: string, @Body() body: unknown) {
    const input = parseBody(DailyUploadBody, body);
    await this.account.requireConsent(userId, "health_data_sync");
    return this.data.upsertDaily(userId, input.records, { timeZone: input.timeZone, sourceDevice: input.sourceDevice, syncRunId: input.syncRunId });
  }

  /** One value per day and metric (Apple Health preferred over readings entered by hand). At most 400 days per call. */
  @Get("daily")
  async daily(@UserId() userId: string, @Query("from") from?: string, @Query("to") to?: string, @Query("kinds") kinds?: string) {
    const range = z
      .object({ from: day, to: day })
      .refine((r) => r.from <= r.to && (Date.parse(r.to) - Date.parse(r.from)) / 86_400_000 < 400, "range")
      .safeParse({ from, to });
    if (!range.success) throw new ApiError("validation_failed", "Check these fields: from, to (at most 400 days).", HttpStatus.BAD_REQUEST);
    const parsedKinds = typeof kinds === "string" ? (kinds.split(",").filter((k) => (KINDS as readonly string[]).includes(k)) as MeasurementKind[]) : undefined;
    return { records: await this.data.daily(userId, range.data.from, range.data.to, parsedKinds) };
  }

  @Get("trends")
  async trend(@UserId() userId: string, @Query("kind") kind?: string, @Query("days") days?: string) {
    const parsedKind = z.enum(KINDS).safeParse(kind);
    const parsedDays = z.coerce.number().int().min(1).max(365).safeParse(days ?? "7");
    const { profile } = await this.profiles.get(userId);
    return this.data.trend(userId, parsedKind.success ? parsedKind.data : "steps", parsedDays.success ? parsedDays.data : 7, profile.timeZone);
  }

  @Get("latest")
  latest(@UserId() userId: string) {
    return this.data.latest(userId);
  }

  @Delete("apple-health")
  @RateLimit("health-disconnect", 10, 60_000)
  async disconnectAppleHealth(@UserId() userId: string) {
    return { removed: await this.data.removeSource(userId, "apple_health") };
  }
}

/** Apple Health (HealthKit) connection state. Reading HealthKit happens on the iPhone only. */
@Controller("v1/healthkit")
@UseGuards(AuthGuard, RateLimitGuard)
@RateLimit("healthkit", 60, 60_000)
export class HealthKitController {
  constructor(
    @Inject(HealthDataService) private readonly data: HealthDataService,
    @Inject(AccountService) private readonly account: AccountService,
  ) {}

  @Get("connection")
  connection(@UserId() userId: string) {
    return this.data.connection(userId);
  }

  @Put("connection")
  async connect(@UserId() userId: string, @Body() body: unknown) {
    const input = parseBody(ConnectBody, body);
    await this.account.requireConsent(userId, "health_data_sync");
    return this.data.connect(userId, input);
  }

  /** A sync from the iPhone starts: history import, automatic or manual. */
  @Post("sync-runs")
  async startRun(@UserId() userId: string, @Body() body: unknown) {
    const input = parseBody(StartRunBody, body);
    await this.account.requireConsent(userId, "health_data_sync");
    return this.data.startSyncRun(userId, input);
  }

  /** …and finishes, with counts and an error code only (never health values). */
  @Patch("sync-runs/:id")
  finishRun(@UserId() userId: string, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.data.finishSyncRun(userId, id, parseBody(FinishRunBody, body));
  }

  /** Disconnects and removes everything synced from Apple Health. */
  @Delete("connection")
  @RateLimit("health-disconnect", 10, 60_000)
  async disconnect(@UserId() userId: string) {
    return { removed: await this.data.removeSource(userId, "apple_health") };
  }
}
