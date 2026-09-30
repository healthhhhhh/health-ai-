import { Inject, Injectable, Logger } from "@nestjs/common";
import { DATABASE, type Database, type Queryable } from "../db/database";

export type AuditAction =
  | "auth.register"
  | "auth.login"
  | "auth.login_failed"
  | "auth.logout"
  | "auth.refresh_reuse_detected"
  | "account.export"
  | "account.delete"
  | "consent.update"
  | "document.delete"
  | "document.download"
  | "account.delete_requested"
  | "auth.password_reset_requested"
  | "auth.password_changed"
  | "auth.identity_linked"
  | "auth.identity_unlinked"
  | "push.device_registered"
  | "push.device_unregistered";

/**
 * Security audit trail. Metadata must never contain health content — only
 * identifiers, counts and outcomes.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger("Audit");

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async log(action: AuditAction, userId: string | null, metadata: Record<string, string | number | boolean> = {}, tx?: Queryable) {
    try {
      await (tx ?? this.db).query("INSERT INTO audit_logs (user_id, action, metadata) VALUES ($1, $2, $3::jsonb)", [userId, action, JSON.stringify(metadata)]);
    } catch (error) {
      // Auditing must not break the user's request, but it must be visible.
      this.logger.error(`audit write failed for ${action}`, error instanceof Error ? error.stack : undefined);
    }
  }
}
