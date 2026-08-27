import type {
  StarlingAccount,
  StarlingAccountIdentifiers,
  StarlingBalance,
  StarlingFeedItem,
} from "./types";

const BASE_URL = "https://api.starlingbank.com/api/v2";

// Starling rejects ranges beyond roughly a year with QUERY_EXCEEDING_MAX_TIME_RANGE,
// so history is walked in windows well inside that limit.
const WINDOW_DAYS = 80;

export class StarlingApi {
  async #get<T>(path: string, accessToken: string): Promise<T> {
    const response = await fetch(`${BASE_URL}${path}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Starling ${path} failed (${response.status}): ${body.slice(0, 300)}`,
      );
    }

    const payload = (await response.json()) as T & {
      success?: boolean;
      errors?: { message: string }[];
    };

    // Starling reports some failures in the body with a 200 status.
    if (payload?.success === false) {
      const messages = (payload.errors ?? []).map((e) => e.message).join(", ");
      throw new Error(`Starling ${path} error: ${messages}`);
    }

    return payload;
  }

  async getHealthCheck(accessToken?: string): Promise<boolean> {
    if (!accessToken) return false;
    try {
      await this.#get<{ accounts: StarlingAccount[] }>("/accounts", accessToken);
      return true;
    } catch {
      return false;
    }
  }

  async getAccounts(accessToken: string): Promise<StarlingAccount[]> {
    const { accounts } = await this.#get<{ accounts: StarlingAccount[] }>(
      "/accounts",
      accessToken,
    );
    return accounts ?? [];
  }

  async getAccountIdentifiers(
    accountUid: string,
    accessToken: string,
  ): Promise<StarlingAccountIdentifiers | null> {
    try {
      return await this.#get<StarlingAccountIdentifiers>(
        `/accounts/${accountUid}/identifiers`,
        accessToken,
      );
    } catch {
      // Identifiers are a nicety; never fail an account sync over them.
      return null;
    }
  }

  async getBalance(
    accountUid: string,
    accessToken: string,
  ): Promise<StarlingBalance> {
    return this.#get<StarlingBalance>(
      `/accounts/${accountUid}/balance`,
      accessToken,
    );
  }

  /**
   * Settled transactions for an account.
   *
   * `latest` fetches the recent window only, which is what scheduled syncs
   * want. Otherwise we walk back `months`, chunked to stay inside Starling's
   * maximum query range, de-duplicating on feedItemUid.
   */
  async getTransactions({
    accountUid,
    accessToken,
    latest,
    months = 24,
  }: {
    accountUid: string;
    accessToken: string;
    latest?: boolean;
    months?: number;
  }): Promise<StarlingFeedItem[]> {
    const now = new Date();
    const start = new Date(now);
    if (latest) {
      start.setDate(start.getDate() - 30);
    } else {
      start.setMonth(start.getMonth() - months);
    }

    const byUid = new Map<string, StarlingFeedItem>();
    let cursor = start;

    while (cursor < now) {
      const windowEnd = new Date(
        Math.min(
          cursor.getTime() + WINDOW_DAYS * 24 * 60 * 60 * 1000,
          now.getTime(),
        ),
      );

      const { feedItems } = await this.#get<{ feedItems: StarlingFeedItem[] }>(
        `/feed/account/${accountUid}/settled-transactions-between` +
          `?minTransactionTimestamp=${cursor.toISOString()}` +
          `&maxTransactionTimestamp=${windowEnd.toISOString()}`,
        accessToken,
      );

      for (const item of feedItems ?? []) {
        if (item.feedItemUid) byUid.set(item.feedItemUid, item);
      }

      cursor = windowEnd;
    }

    return [...byUid.values()];
  }
}
