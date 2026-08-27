import { createLoggerWithContext } from "@midday/logger";
import type { QueueOptions, WorkerOptions } from "bullmq";
import { getRedisConnection } from "../config";
import type { QueueConfig } from "../types/queue-config";

const logger = createLoggerWithContext("worker:queue:banking");

const bankingQueueOptions: QueueOptions = {
  connection: getRedisConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: {
      age: 24 * 3600,
      count: 100,
    },
    removeOnFail: {
      age: 7 * 24 * 3600,
    },
  },
};

const bankingWorkerOptions: WorkerOptions = {
  connection: getRedisConnection(),
  // One at a time: this talks to external bank APIs and there is no benefit
  // to racing them, only rate limits to trip over.
  concurrency: 1,
  lockDuration: 600000, // 10 minutes - full history syncs are slow
};

/**
 * Banking queue configuration
 * For syncing balances and transactions from connected banks
 */
export const bankingQueueConfig: QueueConfig = {
  name: "banking",
  queueOptions: bankingQueueOptions,
  workerOptions: bankingWorkerOptions,
  eventHandlers: {
    onCompleted: (job) => {
      logger.info(`[worker:queue:banking] Job completed`, {
        jobId: job.id,
        jobName: job.name,
      });
    },
    onFailed: (job, error) => {
      logger.error(`[worker:queue:banking] Job failed`, {
        jobId: job?.id,
        jobName: job?.name,
        error: error?.message,
      });
    },
  },
};
