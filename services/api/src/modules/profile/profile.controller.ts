import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { AuthGuard, UserId } from "../../common/auth";
import { parseBody } from "../../common/errors";
import { ProfileService } from "./profile.service";

const source = z.enum(["user_reported", "clinician_provided", "document_extracted"]).default("user_reported");

const ProfilePatch = z
  .object({
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().max(80),
    dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    sex: z.enum(["female", "male", "intersex", "prefer_not_to_say"]).nullable(),
    heightCm: z.number().min(30).max(272).nullable(),
    timeZone: z.string().max(64),
  })
  .partial();

const ConditionBody = z.object({ name: z.string().trim().min(1).max(120), status: z.enum(["active", "resolved"]).default("active"), source, notes: z.string().max(500).nullable().optional() });
const AllergyBody = z.object({ substance: z.string().trim().min(1).max(120), reaction: z.string().max(200).nullable().optional(), severity: z.enum(["mild", "moderate", "severe"]).nullable().optional(), source });
/** `instruction` is saved exactly as sent (only surrounding whitespace is trimmed by the client). */
const MedicationBody = z.object({
  name: z.string().trim().min(1).max(120),
  instruction: z.string().min(1).max(500),
  source: z.enum(["user_reported", "clinician_provided"]),
});
const MedicationPatch = z.object({ active: z.boolean() });

@Controller("v1/me")
@UseGuards(AuthGuard)
export class ProfileController {
  constructor(@Inject(ProfileService) private readonly profiles: ProfileService) {}

  @Get()
  get(@UserId() userId: string) {
    return this.profiles.get(userId);
  }

  @Patch("profile")
  update(@UserId() userId: string, @Body() body: unknown) {
    return this.profiles.updateProfile(userId, parseBody(ProfilePatch, body));
  }

  @Post("conditions")
  async addCondition(@UserId() userId: string, @Body() body: unknown) {
    return { id: await this.profiles.addCondition(userId, parseBody(ConditionBody, body)) };
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
    return this.profiles.setMedicationActive(userId, id, parseBody(MedicationPatch, body).active);
  }

  @Delete("medications/:id")
  @HttpCode(204)
  removeMedication(@UserId() userId: string, @Param("id", ParseUUIDPipe) id: string) {
    return this.profiles.remove(userId, "medications", id);
  }
}
