import { Provider } from "@midday/banking";
import {
  getBankAccounts,
  updateBankAccount,
  upsertTransactions,
} from "@midday/db/queries";
import { bankAccounts } from "@midday/db/schema";
import { and, eq, isNotNull } from "drizzle-orm";
import { triggerJob } from "@midday/job-client";
import type { Job } from "bullmq";
import { getDb } from "../../utils/db";
import { BaseProcessor } from "../base";

export type SyncBankAccountsPayload = {
  /** Omitted by the scheduler, which syncs every team that has a connection. */
  teamId?: string;
  /** Manual syncs fetch full history and ignore the retry gate. */
  manualSync?: boolean;
};

/** Matches the Trigger.dev pipeline: give up on an account after repeated failures. */
const MAX_ERROR_RETRIES = 4;

/** The Trigger.dev pipeline upserts in batches of this size. */
const BATCH_SIZE = 500;

type MethodValue = "other" | "card_purchase" | "transfer";

function mapMethod(method: string | null | undefined): MethodValue {
  switch (method) {
    case "card":
      return "card_purchase";
    case "transfer":
    case "bank":
      return "transfer";
    default:
      return "other";
  }
}

/**
 * Sync connected bank accounts.
 *
 * Midday's original bank sync runs on Trigger.dev as a fan-out
 * (scheduler -> connection -> account -> upsert). Trigger.dev is not part of a
 * self-hosted deployment, so this collapses that chain into one BullMQ job
 * while preserving the behaviour that matters:
 *
 *  - `latest` is false only for manual syncs, so scheduled runs fetch a recent
 *    window and manual runs re-pull full history.
 *  - Dedupe is the database's job: internal_id is `${teamId}_${providerId}` and
 *    the upsert does ON CONFLICT DO NOTHING, so re-running is safe.
 *  - error_retries is cleared on success and incremented on a disconnect, and
 *    accounts past the limit are skipped unless the sync was manual.
 *  - A balance error that is not a disconnect is logged and the account still
 *    proceeds to transactions, matching the original's deliberate asymmetry.
 */
export class SyncBankAccountsProcessor extends BaseProcessor<SyncBankAccountsPayload> {
  async process(job: Job<SyncBankAccountsPayload>) {
    const { teamId: requestedTeamId, manualSync = false } = job.data;
    const db = getDb();

    // The scheduler fires without a team, so resolve every team that actually
    // has a connected (non-manual) account rather than walking all teams.
    const teamIds = requestedTeamId
      ? [requestedTeamId]
      : (
          await db
            .selectDistinct({ teamId: bankAccounts.teamId })
            .from(bankAccounts)
            .where(
              and(
                eq(bankAccounts.enabled, true),
                eq(bankAccounts.manual, false),
                isNotNull(bankAccounts.bankConnectionId),
              ),
            )
        ).map((row) => row.teamId);

    let totalAccounts = 0;
    let totalInserted = 0;

    for (const teamId of teamIds) {
      const result = await this.syncTeam(teamId, manualSync);
      totalAccounts += result.accounts;
      totalInserted += result.inserted;
    }

    this.logger.info("Bank sync complete", {
      teams: teamIds.length,
      accounts: totalAccounts,
      inserted: totalInserted,
    });

    return { teams: teamIds.length, accounts: totalAccounts, inserted: totalInserted };
  }

  private async syncTeam(teamId: string, manualSync: boolean) {
    const db = getDb();

    const accounts = await getBankAccounts(db, {
      teamId,
      enabled: true,
      manual: false,
    });

    const syncable = accounts.filter((account) => {
      if (!account.bankConnection?.accessToken) return false;
      if (manualSync) return true;
      return (account.errorRetries ?? 0) < MAX_ERROR_RETRIES;
    });

    this.logger.info("Starting bank sync", {
      teamId,
      manualSync,
      candidates: accounts.length,
      syncable: syncable.length,
    });

    let inserted = 0;
    const newTransactionIds: string[] = [];

    for (const account of syncable) {
      const connection = account.bankConnection!;
      const provider = new Provider({
        provider: connection.provider as ConstructorParameters<
          typeof Provider
        >[0]["provider"],
      });
      const accessToken = connection.accessToken!;
      const accountType = account.type ?? "depository";

      // --- balance -------------------------------------------------------
      try {
        const balance = await provider.getAccountBalance({
          accountId: account.accountId!,
          accessToken,
          accountType,
        });

        if (balance) {
          await updateBankAccount(db, {
            id: account.id,
            teamId,
            balance: balance.amount,
            errorDetails: null,
            errorRetries: null,
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const disconnected = message.toLowerCase().includes("disconnect");

        if (disconnected) {
          await updateBankAccount(db, {
            id: account.id,
            teamId,
            errorDetails: message.slice(0, 500),
            errorRetries: (account.errorRetries ?? 0) + 1,
          });
          this.logger.error("Account disconnected", {
            accountId: account.id,
            retries: (account.errorRetries ?? 0) + 1,
          });
          // Rethrowing here would abandon every remaining account, so move on.
          continue;
        }

        this.logger.warn("Balance fetch failed, continuing to transactions", {
          accountId: account.id,
          error: message,
        });
      }

      // --- transactions --------------------------------------------------
      const providerTransactions = await provider.getTransactions({
        accountId: account.accountId!,
        accessToken,
        accountType,
        latest: !manualSync,
      });

      if (!providerTransactions?.length) {
        this.logger.info("No transactions returned", { accountId: account.id });
        continue;
      }

      for (let i = 0; i < providerTransactions.length; i += BATCH_SIZE) {
        const batch = providerTransactions
          .slice(i, i + BATCH_SIZE)
          .map((transaction) => ({
            name: transaction.name,
            date: transaction.date,
            amount: transaction.amount,
            currency: transaction.currency,
            teamId,
            bankAccountId: account.id,
            // The uniqueness key. Namespacing by team matches the original
            // pipeline so a re-sync can never duplicate a row.
            internalId: `${teamId}_${transaction.id}`,
            method: mapMethod(transaction.method),
            status: "posted" as const,
            manual: false,
            categorySlug: transaction.category ?? null,
            description: transaction.description ?? null,
            balance: transaction.balance ?? null,
            note: null,
            counterpartyName: transaction.counterparty_name ?? null,
            merchantName: transaction.merchant_name ?? null,
            assignedId: null,
            internal: false,
            // Manual syncs skip the notification sweep, as upstream does.
            notified: manualSync,
            baseAmount: null,
            baseCurrency: null,
            taxAmount: null,
            taxRate: null,
            taxType: null,
            recurring: false,
            frequency: null,
            enrichmentCompleted: false,
          }));

        const upserted = await upsertTransactions(db, {
          transactions: batch,
          teamId,
        });

        // Only genuinely new rows come back; conflicts are skipped silently.
        inserted += upserted.length;
        newTransactionIds.push(...upserted.map((row) => row.id));
      }
    }

    if (newTransactionIds.length > 0) {
      await triggerJob(
        "enrich-transactions",
        { transactionIds: newTransactionIds, teamId },
        "transactions",
      );

      await triggerJob(
        "match-transactions-bidirectional",
        { teamId, newTransactionIds },
        "inbox",
      );
    }

    this.logger.info("Team sync complete", {
      teamId,
      accounts: syncable.length,
      inserted,
    });

    return { accounts: syncable.length, inserted };
  }
}
