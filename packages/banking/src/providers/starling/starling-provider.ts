import type { Provider } from "../../interface";
import type {
  DeleteAccountsRequest,
  DeleteConnectionRequest,
  GetAccountBalanceRequest,
  GetAccountsRequest,
  GetConnectionStatusRequest,
  GetInstitutionsRequest,
  GetTransactionsRequest,
} from "../../types";
import { StarlingApi } from "./starling-api";
import {
  STARLING_INSTITUTION,
  transformAccount,
  transformAccountBalance,
  transformTransaction,
} from "./transform";

/**
 * Direct Starling Bank provider.
 *
 * The aggregators (GoCardless, Plaid, Teller, Enable Banking) sit between
 * Midday and the bank. Starling publishes its own API, so for a single UK
 * account we can talk to it directly and skip the aggregator entirely.
 *
 * The access token is a Starling personal access token rather than an OAuth
 * grant, so there is no redirect flow and nothing expires on a provider's
 * schedule - the token is long lived and rotated by the account holder.
 */
export class StarlingProvider implements Provider {
  #api: StarlingApi;

  constructor() {
    this.#api = new StarlingApi();
  }

  async getHealthCheck() {
    // Without a token there is nothing to check; report healthy so an
    // unconfigured Starling never marks the whole estate as down.
    return true;
  }

  async getAccounts({ accessToken, id }: GetAccountsRequest) {
    if (!accessToken) {
      throw Error("accessToken missing");
    }

    const accounts = await this.#api.getAccounts(accessToken);
    const wanted = id ? accounts.filter((a) => a.accountUid === id) : accounts;

    return Promise.all(
      wanted.map(async (account) => {
        const [balance, identifiers] = await Promise.all([
          this.#api.getBalance(account.accountUid, accessToken),
          this.#api.getAccountIdentifiers(account.accountUid, accessToken),
        ]);
        return transformAccount({ account, balance, identifiers });
      }),
    );
  }

  async getAccountBalance({
    accountId,
    accessToken,
  }: GetAccountBalanceRequest) {
    if (!accessToken) {
      throw Error("accessToken missing");
    }
    const balance = await this.#api.getBalance(accountId, accessToken);
    return transformAccountBalance(balance);
  }

  async getTransactions({
    accountId,
    accessToken,
    latest,
  }: GetTransactionsRequest) {
    if (!accessToken) {
      throw Error("accessToken missing");
    }

    const items = await this.#api.getTransactions({
      accountUid: accountId,
      accessToken,
      latest,
    });

    return items
      .filter((item) => item.status !== "DECLINED" && item.status !== "REVERSED")
      .map(transformTransaction);
  }

  async getInstitutions({ countryCode }: GetInstitutionsRequest) {
    // Starling is UK only.
    if (countryCode && countryCode.toUpperCase() !== "GB") {
      return [];
    }
    return [STARLING_INSTITUTION];
  }

  async getConnectionStatus({ accessToken }: GetConnectionStatusRequest) {
    if (!accessToken) {
      return { status: "disconnected" as const };
    }
    const healthy = await this.#api.getHealthCheck(accessToken);
    return { status: healthy ? ("connected" as const) : ("disconnected" as const) };
  }

  async deleteAccounts(_params: DeleteAccountsRequest) {
    // Nothing to revoke remotely: the token belongs to the account holder and
    // is rotated in Starling's developer portal, not by us.
  }

  async deleteConnection(_params: DeleteConnectionRequest) {
    // As above.
  }
}
