import { type INestApplication, Logger } from "@nestjs/common";
import { CONFIG, type AppConfig } from "./config";
import { DATABASE, type Database } from "./db/database";
import { AccountService } from "./modules/account/account.service";
import { AiGateway } from "./modules/ai/ai.gateway";
import { DocumentsService } from "./modules/documents/documents.service";
import { pruneOperationalRecords } from "./retention";

/**
 * Periodic housekeeping: marks report/photo processing that was interrupted
 * (crash, deploy) as failed, and completes account deletions that were
 * interrupted part-way, charges AI cost reservations left held by interrupted
 * requests, and prunes operational logs past their retention
 * period (never health data). Runs in the worker (or the API when there's no Redis).
 */
export function startMaintenance(app: INestApplication, intervalMs = 5 * 60_000): () => void {
  const logger = new Logger("Maintenance");
  const documents = app.get(DocumentsService);
  const account = app.get(AccountService);
  const ai = app.get(AiGateway);
  const db = app.get<Database>(DATABASE);
  const config = app.get<AppConfig>(CONFIG);
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const stuck = await documents.recoverStuck();
      const deleted = await account.finishPendingDeletions();
      if (stuck || deleted) logger.log(`recovered ${stuck} stuck upload(s), finished ${deleted} deletion(s)`);
      const expired = await ai.expireStaleReservations();
      if (expired) logger.warn(`charged ${expired} AI reservation(s) left by interrupted requests`);
      const pruned = Object.values(await pruneOperationalRecords(db, config)).reduce((a, b) => a + b, 0);
      if (pruned) logger.log(`pruned ${pruned} operational record(s) past retention`);
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
