import { Body, Controller, Delete, Get, Inject, Post, Put, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { AuthGuard, UserId } from "../../common/auth";
import { parseBody } from "../../common/errors";
import { RateLimit, RateLimitGuard } from "../../common/rate-limit";
import { AccountService } from "../account/account.service";
import { ProfileService } from "../profile/profile.service";
import { HealthDataService, MEASUREMENT_UNITS, type MeasurementKind } from "./health-data.service";

const KINDS = Object.keys(MEASUREMENT_UNITS) as [MeasurementKind, ...MeasurementKind[]];

/** Plausibility bounds reject corrupt samples; they are not clinical thresholds. */
const BOUNDS: Record<MeasurementKind, [number, number]> = {
  heart_rate: [20, 300],
  resting_heart_rate: [20, 250],
  steps: [0, 200_000],
  sleep: [0, 1_440],
  active_energy: [0, 20_000],
  weight: [1, 700],
  blood_pressure_systolic: [40, 300],
  blood_pressure_diastolic: [20, 200],
  blood_glucose: [10, 1_500],
  water: [0, 20_000],
};

const Measurement = z
  .object({
    kind: z.enum(KINDS),
    value: z.number().finite(),
    recordedAt: z.string().datetime({ offset: true }),
    source: z.enum(["apple_health", "user_entered"]),
    sourceDevice: z.string().max(120).nullable().optional(),
    externalId: z.string().max(120).nullable().optional(),
  })
  .refine((m) => m.value >= BOUNDS[m.kind][0] && m.value <= BOUNDS[m.kind][1], { message: "value out of range", path: ["value"] });

const ConnectBody = z.object({
  deviceName: z.string().trim().max(120).nullable().optional(),
  scopes: z.array(z.enum(KINDS)).max(KINDS.length),
});

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

  /** Disconnects and removes everything synced from Apple Health. */
  @Delete("connection")
  @RateLimit("health-disconnect", 10, 60_000)
  async disconnect(@UserId() userId: string) {
    return { removed: await this.data.removeSource(userId, "apple_health") };
  }
}
