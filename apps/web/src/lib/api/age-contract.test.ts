import type { AccountSummary, AgeAssessmentRequest, AgeAssessmentResponse, AgeBand, AgeEligibility, AgeStatus, ApiMeta, OAuthSignInRequest } from "@healthmate/shared-types";
import { describe, expect, it } from "vitest";

/**
 * Age contract (shared types). Nothing in the web app reads or shows these fields
 * yet; with enforcement, restricted accounts get 403s whose `error.code` is the
 * eligibility value. Older servers and Preview omit the fields.
 */
const BANDS = { unknown: true, under_13: true, "13_15": true, "16_17": true, adult: true } satisfies Record<AgeBand, true>;
const STATUSES = { unknown: true, in_scope: true, blocked_under_13: true, blocked_out_of_scope: true, review: true } satisfies Record<AgeStatus, true>;
const ELIGIBILITY = { eligible: true, age_required: true, age_review: true, age_not_eligible: true } satisfies Record<AgeEligibility, true>;

describe("age contract", () => {
  it("lists the same bands and statuses as the API (services/api/src/modules/account/age.ts)", () => {
    expect(Object.keys(BANDS)).toEqual(["unknown", "under_13", "13_15", "16_17", "adult"]);
    expect(Object.keys(STATUSES)).toEqual(["unknown", "in_scope", "blocked_under_13", "blocked_out_of_scope", "review"]);
  });

  it("accepts account responses from older servers and with the new fields", () => {
    const older: AccountSummary = JSON.parse(`{"email":"sam@example.com","emailVerified":true,"signInMethods":["password"],"createdAt":"2026-09-30T10:00:00.000Z","onboardingCompleted":true}`);
    expect(older.ageBand).toBeUndefined();
    const current: AccountSummary = JSON.parse(
      `{"email":"sam@example.com","emailVerified":true,"signInMethods":["password"],"createdAt":"2026-09-30T10:00:00.000Z","onboardingCompleted":true,"ageBand":"unknown","ageStatus":"unknown","ageAssessedAt":null}`,
    );
    expect(current.ageBand && current.ageBand in BANDS).toBe(true);
    expect(current.ageStatus && current.ageStatus in STATUSES).toBe(true);
    expect(current.ageAssessedAt).toBeNull();
    const enforced: AccountSummary = JSON.parse(
      `{"email":"sam@example.com","emailVerified":true,"signInMethods":["password"],"createdAt":"2026-09-30T10:00:00.000Z","onboardingCompleted":true,"ageBand":"unknown","ageStatus":"unknown","ageAssessedAt":null,"ageEligibility":"age_required","ageDeletionScheduledAt":null}`,
    );
    expect(enforced.ageEligibility && enforced.ageEligibility in ELIGIBILITY).toBe(true);
    expect(Object.keys(ELIGIBILITY)).toEqual(["eligible", "age_required", "age_review", "age_not_eligible"]);
  });

  it("describes /v1/meta age capability without claiming parental consent", () => {
    const meta: ApiMeta = { apiVersion: 1, ai: { available: true }, age: { enforcement: "enforce", enabledBands: ["13_15", "16_17", "adult"], parentalConsent: false } };
    expect(meta.age?.parentalConsent).toBe(false);
    const older: ApiMeta = { apiVersion: 1, ai: { available: true } };
    expect(older.age).toBeUndefined();
  });

  it("sends only a date of birth, never a band", () => {
    const request: AgeAssessmentRequest = { dateOfBirth: "1990-01-01" };
    expect(JSON.parse(JSON.stringify(request))).toEqual({ dateOfBirth: "1990-01-01" });
    const signIn: OAuthSignInRequest = { provider: "google", idToken: "synthetic", ageScreen: { dateOfBirth: "1990-01-01" } };
    expect(signIn.ageScreen).toEqual({ dateOfBirth: "1990-01-01" });
    const response: AgeAssessmentResponse = { ageBand: "adult", ageStatus: "in_scope", assessedAt: "2026-10-02T12:00:00.000Z", outcome: "applied" };
    expect(response.outcome).toBe("applied");
    const enforced: AgeAssessmentResponse = { ...response, eligibility: "eligible", deletionScheduledAt: null };
    expect(enforced.eligibility).toBe("eligible");
  });
});
