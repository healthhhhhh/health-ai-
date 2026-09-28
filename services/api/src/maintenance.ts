import { type INestApplication, Logger } from "@nestjs/common";
import { AccountService } from "./modules/account/account.service";
import { DocumentsService } from "./modules/documents/documents.service";

/**
 * Periodic housekeeping: marks report/photo processing that was interrupted
 * (crash, deploy) as failed, and completes account deletions that were
 * interrupted part-way. Runs in the worker (or the API when there's no Redis).
 */
export function startMaintenance(app: INestApplication, intervalMs = 5 * 60_000): () => void {
  const logger = new Logger("Maintenance");
  const documents = app.get(DocumentsService);
  const account = app.get(AccountService);
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const stuck = await documents.recoverStuck();
      const deleted = await account.finishPendingDeletions();
      if (stuck || deleted) logger.log(`recovered ${stuck} stuck upload(s), finished ${deleted} deletion(s)`);
    } catch (error) {
      logger.error(`maintenance failed (${error instanceof Error ? error.name : "unknown"})`);
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
