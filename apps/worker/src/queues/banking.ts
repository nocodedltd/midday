import { Queue } from "bullmq";
import { bankingQueueConfig } from "./banking.config";

export const bankingQueue = new Queue(
  "banking",
  bankingQueueConfig.queueOptions,
);
