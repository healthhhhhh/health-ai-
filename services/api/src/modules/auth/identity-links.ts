import { HttpStatus } from "@nestjs/common";
import { ApiError } from "../../common/errors";
import type { Queryable } from "../../db/database";
import type { OAuthProvider, VerifiedIdentity } from "./oauth";

/**
 * `auth_identities`: which external sign-in (Google today, Apple later) belongs
 * to which HealthMate account. Shared by the local and Supabase identity
 * providers so the account model is the same in both.
 */
export const providerName = (provider: OAuthProvider) => (provider === "google" ? "Google" : "Apple");

export async function findLinkedUser(db: Queryable, provider: OAuthProvider, subject: string): Promise<string | null> {
  const { rows } = await db.query<{ user_id: string }>(`SELECT user_id FROM auth_identities WHERE provider = $1 AND subject = $2`, [provider, subject]);
  return rows[0]?.user_id ?? null;
}

/** Records a sign-in with an identity already linked to this account. */
export async function touchIdentity(db: Queryable, userId: string, identity: VerifiedIdentity) {
  await db.query(`UPDATE auth_identities SET last_sign_in_at = now(), email = COALESCE($4, email) WHERE user_id = $1 AND provider = $2 AND subject = $3`, [
    userId,
    identity.provider,
    identity.subject,
    identity.email,
  ]);
}

/**
 * Links an identity to an account. Refuses when the identity belongs to
 * someone else or the account already has a different identity from the same
 * provider. Idempotent for the same pair.
 */
export async function linkIdentity(db: Queryable, userId: string, identity: VerifiedIdentity): Promise<"linked" | "already_linked"> {
  const owner = await findLinkedUser(db, identity.provider, identity.subject);
  const name = providerName(identity.provider);
  if (owner === userId) {
    await touchIdentity(db, userId, identity);
    return "already_linked";
  }
  if (owner) throw new ApiError("conflict", `This ${name} account is already connected to another HealthMate account.`, HttpStatus.CONFLICT);
  const { rows } = await db.query(`SELECT 1 FROM auth_identities WHERE user_id = $1 AND provider = $2`, [userId, identity.provider]);
  if (rows[0]) throw new ApiError("conflict", `A different ${name} account is already connected. Disconnect it first.`, HttpStatus.CONFLICT);
  await db.query(`INSERT INTO auth_identities (user_id, provider, subject, email) VALUES ($1, $2, $3, $4)`, [userId, identity.provider, identity.subject, identity.email]);
  return "linked";
}

export async function linkedProviders(db: Queryable, userId: string): Promise<OAuthProvider[]> {
  const { rows } = await db.query<{ provider: OAuthProvider }>(`SELECT provider FROM auth_identities WHERE user_id = $1 ORDER BY provider`, [userId]);
  return rows.map((r) => r.provider);
}

/** Fills in an empty profile name from the identity (never overwrites what the person entered). */
export async function fillProfileName(db: Queryable, userId: string, firstName: string, lastName: string) {
  await db.query(
    `UPDATE profiles SET first_name = CASE WHEN first_name = '' THEN $2 ELSE first_name END,
                         last_name = CASE WHEN first_name = '' AND last_name = '' THEN $3 ELSE last_name END
      WHERE user_id = $1`,
    [userId, firstName.slice(0, 80), lastName.slice(0, 80)],
  );
}
