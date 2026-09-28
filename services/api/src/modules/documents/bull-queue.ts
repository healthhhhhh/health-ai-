import { Logger, type OnApplicationShutdown } from "@nestjs/common";
import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { JobQueue, type JobHandler, type JobName, type JobOptions, type JobPayloads } from "./job-queue";

const QUEUE = "healthmate";

/**
 * Redis-backed jobs (BullMQ). Survives restarts, retries with exponential
 * backoff and can run in a separate worker process (`npm run worker`).
 * Payloads are ids only; finished jobs are removed quickly.
 */
export class BullJobQueue extends JobQueue implements OnApplicationShutdown {
  private readonly logger = new Logger("BullJobQueue");
  private readonly connection: Redis;
  private readonly queue: Queue;
  private readonly handlers = new Map<JobName, JobHandler<JobName>>();
  private worker?: Worker;

  constructor(
    redisUrl: string,
    private readonly options: { runWorker: boolean; concurrency?: number; prefix?: string } = { runWorker: false },
  ) {
    super();
    this.connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue(QUEUE, { connection: this.connection, prefix: options.prefix });
  }

  register<N extends JobName>(name: N, handler: JobHandler<N>) {
    this.handlers.set(name, handler as JobHandler<JobName>);
    if (this.options.runWorker) this.startWorker();
  }

  async enqueue<N extends JobName>(name: N, data: JobPayloads[N], options: JobOptions = {}) {
    await this.queue.add(name, data, {
      jobId: options.jobId,
      attempts: options.attempts ?? 3,
      backoff: { type: "exponential", delay: 2_000 },
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 7 * 24 * 3600 },
    });
  }

  /** Starts processing in this process (the worker entry point, or RUN_WORKER_IN_API). */
  startWorker() {
    if (this.worker) return;
    this.worker = new Worker(
      QUEUE,
      async (job: Job) => {
        const handler = this.handlers.get(job.name as JobName);
        if (!handler) throw new Error(`no handler for ${job.name}`);
        await handler(job.data as never);
      },
      { connection: this.connection.duplicate(), concurrency: this.options.concurrency ?? 4, prefix: this.options.prefix },
    );
    this.worker.on("failed", (job, error) => {
      // Error names only: messages may echo document content.
      this.logger.warn(`job ${job?.name ?? "?"} attempt ${job?.attemptsMade ?? 0} failed (${error.name})`);
    });
  }

  async drain(): Promise<void> {
    for (;;) {
      const counts = await this.queue.getJobCounts("waiting", "active", "delayed", "prioritized");
      if (Object.values(counts).every((n) => n === 0)) return;
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  async onApplicationShutdown() {
    await this.worker?.close();
    await this.queue.close();
    this.connection.disconnect();
  }
}
