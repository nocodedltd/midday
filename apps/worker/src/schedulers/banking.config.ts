import type { StaticSchedulerConfig } from "../types/scheduler-config";

/**
 * Scheduled bank sync.
 *
 * Upstream registers one cron per team via Trigger.dev's dynamic schedules,
 * spread across the hour to avoid hammering providers. A self-hosted instance
 * has a handful of teams at most, so a single static schedule is enough; the
 * processor iterates teams itself.
 */
export const bankingStaticSchedulers: StaticSchedulerConfig[] = [
  {
    name: "sync-bank-accounts",
    queue: "banking",
    cron: "0 */4 * * *", // every four hours
    jobName: "sync-bank-accounts",
    payload: {},
    options: { tz: "UTC" },
  },
];
