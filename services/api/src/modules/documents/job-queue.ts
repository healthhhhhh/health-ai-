import { Injectable, Logger, OnApplicationShutdown } from "@nestjs/common";

export type Job = () => Promise<void>;

/**
 * Background work queue for document/image processing, so uploads return
 * immediately and clients poll for status.
 *
 * This in-process implementation is correct for a single API instance and
 * drains on shutdown. Running several instances requires a shared queue
 * (Redis/BullMQ, spec §7.1) behind this same interface.
 */
@Injectable()
export class JobQueue implements OnApplicationShutdown {
  private readonly logger = new Logger("JobQueue");
  private readonly pending: Job[] = [];
  private running = 0;
  private readonly idleWaiters: (() => void)[] = [];
  private readonly concurrency = 2;

  enqueue(job: Job) {
    this.pending.push(job);
    this.pump();
  }

  /** Resolves when every queued job has finished (used by tests and shutdown). */
  async drain(): Promise<void> {
    if (this.running === 0 && this.pending.length === 0) return;
    await new Promise<void>((resolve) => this.idleWaiters.push(resolve));
  }

  async onApplicationShutdown() {
    await this.drain();
  }

  private pump() {
    while (this.running < this.concurrency && this.pending.length) {
      const job = this.pending.shift()!;
      this.running += 1;
      job()
        .catch((error) => this.logger.error("job failed", error instanceof Error ? error.stack : undefined))
        .finally(() => {
          this.running -= 1;
          this.pump();
          if (this.running === 0 && this.pending.length === 0) this.idleWaiters.splice(0).forEach((resolve) => resolve());
        });
    }
  }
}
