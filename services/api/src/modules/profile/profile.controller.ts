import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Put, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { AuthGuard, UserId } from "../../common/auth";
import { RateLimit, RateLimitGuard } from "../../common/rate-limit";
import { parseBody } from "../../common/errors";
import { ProfileService } from "./profile.service";

const source = z.enum(["user_reported", "clinician_provided", "document_extracted"]).default("user_reported");
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => !Number.isNaN(Date.parse(d)), "Invalid date");
const sourceRef = z.string().trim().max(200).nullable().optional();
const validTimeZone = z.string().min(1).max(64).refine((tz) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, "Unknown time zone");

const ProfilePatch = z
  .object({
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().max(80),
    dateOfBirth: day.nullable(),
    sex: z.enum(["female", "male", "intersex", "prefer_not_to_say"]).nullable(),
    heightCm: z.number().min(30).max(272).nullable(),
    timeZone: validTimeZone,
    goals: z.array(z.string().trim().min(1).max(40)).max(10),
    unitSystem: z.enum(["metric", "imperial"]),
  })
  .partial();

const ConditionBody = z.object({
  name: z.string().trim().min(1).max(120),
  status: z.enum(["active", "resolved"]).default("active"),
  source,
  notes: z.string().max(500).nullable().optional(),
  onsetOn: day.nullable().optional(),
  resolvedOn: day.nullable().optional(),
  sourceRef,
});
const ConditionPatch = z
  .object({ name: z.string().trim().min(1).max(120), status: z.enum(["active", "resolved"]), notes: z.string().max(500).nullable(), onsetOn: day.nullable(), resolvedOn: day.nullable() })
  .partial();
const AllergyBody = z.object({
  substance: z.string().trim().min(1).max(120),
  reaction: z.string().max(200).nullable().optional(),
  severity: z.enum(["mild", "moderate", "severe"]).nullable().optional(),
  source,
  notedOn: day.nullable().optional(),
  sourceRef,
});
const AllergyPatch = z
  .object({ substance: z.string().trim().min(1).max(120), reaction: z.string().max(200).nullable(), severity: z.enum(["mild", "moderate", "severe"]).nullable(), status: z.enum(["active", "inactive"]) })
  .partial();
/** `instruction` is saved exactly as sent (only surrounding whitespace is trimmed by the client). */
const MedicationBody = z.object({
  name: z.string().trim().min(1).max(120),
  instruction: z.string().min(1).max(500),
  source: z.enum(["user_reported", "clinician_provided"]),
  startedOn: day.nullable().optional(),
  sourceRef,
});
/** What the person reports about taking it; never a change HealthMate makes. The instruction can't be edited here. */
const MedicationPatch = z.object({ active: z.boolean(), startedOn: day.nullable().optional(), stoppedOn: day.nullable().optional() });

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const NotificationPreferencesBody = z
  .object({
    medication: z.boolean(),
    task: z.boolean(),
    appointment: z.boolean(),
    report: z.boolean(),
    insight: z.boolean(),
    account: z.boolean(),
    showDetails: z.boolean(),
    quietHours: z.object({ enabled: z.boolean(), start: time, end: time }).partial(),
  })
  .partial();

@Controller("v1/me")
@UseGuards(AuthGuard, RateLimitGuard)
@RateLimit("profile", 120, 60_000)
export class ProfileController {
  constructor(@Inject(ProfileService) private readonly profiles: ProfileService) {}

  @Get()
  get(@UserId() userId: string) {
    return this.profiles.get(userId);
  }

  @Get("account")
  account(@UserId() userId: string) {
    return this.profiles.account(userId);
  }

  @Post("onboarding")
  @HttpCode(204)
  completeOnboarding(@UserId() userId: string) {
    return this.profiles.completeOnboarding(userId);
  }

  @Get("notification-preferences")
  notificationPreferences(@UserId() userId: string) {
    return this.profiles.notificationPreferences(userId);
  }

  @Put("notification-preferences")
  setNotificationPreferences(@UserId() userId: string, @Body() body: unknown) {
    return this.profiles.setNotificationPreferences(userId, parseBody(NotificationPreferencesBody, body));
  }

  @Patch("profile")
  update(@UserId() userId: string, @Body() body: unknown) {
    return this.profiles.updateProfile(userId, parseBody(ProfilePatch, body));
  }

  @Post("conditions")
  async addCondition(@UserId() userId: string, @Body() body: unknown) {
    return { id: await this.profiles.addCondition(userId, parseBody(ConditionBody, body)) };
  }

  @Patch("conditions/:id")
  @HttpCode(204)
  updateCondition(@UserId() userId: string, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.profiles.updateCondition(userId, id, parseBody(ConditionPatch, body));
  }

  @Delete("conditions/:id")
  @HttpCode(204)
  removeCondition(@UserId() userId: string, @Param("id", ParseUUIDPipe) id: string) {
    return this.profiles.remove(userId, "health_conditions", id);
  }

  @Post("allergies")
  async addAllergy(@UserId() userId: string, @Body() body: unknown) {
    return { id: await this.profiles.addAllergy(userId, parseBody(AllergyBody, body)) };
  }

  @Patch("allergies/:id")
  @HttpCode(204)
  updateAllergy(@UserId() userId: string, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.profiles.updateAllergy(userId, id, parseBody(AllergyPatch, body));
  }

  @Delete("allergies/:id")
  @HttpCode(204)
  removeAllergy(@UserId() userId: string, @Param("id", ParseUUIDPipe) id: string) {
    return this.profiles.remove(userId, "allergies", id);
  }

  @Post("medications")
  async addMedication(@UserId() userId: string, @Body() body: unknown) {
    return { id: await this.profiles.addMedication(userId, parseBody(MedicationBody, body)) };
  }

  @Patch("medications/:id")
  @HttpCode(204)
  setMedicationActive(@UserId() userId: string, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.profiles.setMedicationStatus(userId, id, parseBody(MedicationPatch, body));
  }

  @Delete("medications/:id")
  @HttpCode(204)
  removeMedication(@UserId() userId: string, @Param("id", ParseUUIDPipe) id: string) {
    return this.profiles.remove(userId, "medications", id);
  }
}
