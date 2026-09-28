import { Injectable, Logger, OnApplicationShutdown } from "@nestjs/common";

/**
 * Background jobs. Payloads carry ids only — never health content — because
 * with Redis they are stored outside the database.
 */
export interface JobPayloads {
  /** Analyse an uploaded report or photo. */
  "process-document": { userId: string; kind: "report" | "image"; id: string };
  /** Compute the embedding for one health memory. */
  "embed-memory": { userId: string; memoryId: string };
  /** Remove a deleted account's files from Storage. */
  "delete-user-files": { userId: string };
  /** Server-sent reminders (not used yet: iPhone reminders are scheduled on the device). */
  "send-reminder": { userId: string; reminderId: string };
}
export type JobName = keyof JobPayloads;
export type JobHandler<N extends JobName> = (data: JobPayloads[N]) => Promise<void>;

export interface JobOptions {
  /** Stable id so the same work isn't queued twice. */
  jobId?: string;
  attempts?: number;
}

/**
 * Queue interface. `InProcessJobQueue` (below) runs jobs in this process and
 * is used for development and tests; `BullJobQueue` (bull-queue.ts) uses Redis
 * when `REDIS_URL` is set, with retries and a separate worker process.
 */
export abstract class JobQueue {
  abstract register<N extends JobName>(name: N, handler: JobHandler<N>): void;
  abstract enqueue<N extends JobName>(name: N, data: JobPayloads[N], options?: JobOptions): Promise<void>;
  /** Resolves when queued work has finished (tests, shutdown). */
  abstract drain(): Promise<void>;
}

@Injectable()
export class InProcessJobQueue extends JobQueue implements OnApplicationShutdown {
  private readonly logger = new Logger("JobQueue");
  private readonly handlers = new Map<JobName, JobHandler<JobName>>();
  private readonly pending: { name: JobName; data: unknown; attempt: number; attempts: number; key?: string }[] = [];
  private readonly queuedKeys = new Set<string>();
  private running = 0;
  private readonly idleWaiters: (() => void)[] = [];
  private readonly concurrency = 2;

  register<N extends JobName>(name: N, handler: JobHandler<N>) {
    this.handlers.set(name, handler as JobHandler<JobName>);
  }

  async enqueue<N extends JobName>(name: N, data: JobPayloads[N], options: JobOptions = {}) {
    if (options.jobId) {
      if (this.queuedKeys.has(options.jobId)) return;
      this.queuedKeys.add(options.jobId);
    }
    this.pending.push({ name, data, attempt: 1, attempts: options.attempts ?? 3, key: options.jobId });
    this.pump();
  }

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
      const handler = this.handlers.get(job.name);
      this.running += 1;
      const work = handler ? handler(job.data as never) : Promise.reject(new Error(`no handler for ${job.name}`));
      work
        .then(() => {
          if (job.key) this.queuedKeys.delete(job.key);
        })
        .catch((error) => {
          if (job.attempt < job.attempts) {
            this.pending.push({ ...job, attempt: job.attempt + 1 });
          } else {
            if (job.key) this.queuedKeys.delete(job.key);
            this.logger.error(`job ${job.name} failed after ${job.attempt} attempts (${error instanceof Error ? error.name : "unknown"})`);
          }
        })
        .finally(() => {
          this.running -= 1;
          this.pump();
          if (this.running === 0 && this.pending.length === 0) this.idleWaiters.splice(0).forEach((resolve) => resolve());
        });
    }
  }
}
