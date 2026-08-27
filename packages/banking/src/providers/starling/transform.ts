import { capitalCase } from "change-case";
import type {
  Account as BaseAccount,
  Transaction as BaseTransaction,
  GetAccountBalanceResponse,
  Institution,
} from "../../types";
import type {
  StarlingAccount,
  StarlingAccountIdentifiers,
  StarlingBalance,
  StarlingFeedItem,
} from "./types";

/**
 * Starling is a single institution, so unlike the aggregators there is no
 * directory to search. We advertise exactly one.
 */
export const STARLING_INSTITUTION: Institution = {
  id: "starling",
  name: "Starling Bank",
  logo: "https://cdn.brandfetch.io/starlingbank.com/w/400/h/400",
  provider: "starling",
};

const MINOR_UNITS = 100;

/** Starling reports a magnitude plus a direction; Midday wants a signed amount. */
function signedAmount(item: StarlingFeedItem): number {
  const magnitude = Math.abs(item.amount?.minorUnits ?? 0);
  const signed = item.direction === "OUT" ? -magnitude : magnitude;
  return signed / MINOR_UNITS;
}

function mapMethod(item: StarlingFeedItem): string {
  switch (item.source) {
    case "MASTER_CARD":
    case "STRIPE_FUNDING":
      return "card";
    case "DIRECT_DEBIT":
    case "DIRECT_DEBIT_DEPOSIT_PROTECTION":
      return "direct_debit";
    case "FASTER_PAYMENTS_IN":
    case "FASTER_PAYMENTS_OUT":
    case "INTERNAL_TRANSFER":
      return "transfer";
    case "DIRECT_CREDIT":
      return "deposit";
    default:
      return "other";
  }
}

export const transformTransaction = (
  item: StarlingFeedItem,
): BaseTransaction => {
  const counterparty = item.counterPartyName?.trim() || null;
  const reference = item.reference?.trim() || null;

  return {
    id: item.feedItemUid,
    date: (item.transactionTime ?? item.settlementTime ?? "").slice(0, 10),
    name: capitalCase(counterparty ?? reference ?? "Starling transaction"),
    description: reference,
    amount: signedAmount(item),
    currency: (item.amount?.currency ?? "GBP").toUpperCase(),
    method: mapMethod(item),
    // Starling's own spendingCategory is a coarse hint; leave Midday's
    // enrichment to do the real categorisation.
    category: null,
    balance: null,
    counterparty_name: counterparty ? capitalCase(counterparty) : null,
    merchant_name: item.counterPartyType === "MERCHANT" ? counterparty : null,
    status: item.status === "SETTLED" ? "posted" : "pending",
    currency_rate: null,
    currency_source: null,
  };
};

export const transformAccountBalance = (
  balance: StarlingBalance,
): GetAccountBalanceResponse => ({
  currency: (balance.clearedBalance?.currency ?? "GBP").toUpperCase(),
  amount: (balance.clearedBalance?.minorUnits ?? 0) / MINOR_UNITS,
  available_balance:
    balance.effectiveBalance?.minorUnits != null
      ? balance.effectiveBalance.minorUnits / MINOR_UNITS
      : null,
  credit_limit: null,
});

export const transformAccount = ({
  account,
  balance,
  identifiers,
}: {
  account: StarlingAccount;
  balance: StarlingBalance;
  identifiers: StarlingAccountIdentifiers | null;
}): BaseAccount => ({
  id: account.accountUid,
  name: account.name || "Starling",
  currency: (account.currency ?? "GBP").toUpperCase(),
  type: "depository",
  institution: STARLING_INSTITUTION,
  balance: {
    amount: (balance.clearedBalance?.minorUnits ?? 0) / MINOR_UNITS,
    currency: (balance.clearedBalance?.currency ?? "GBP").toUpperCase(),
  },
  enrollment_id: null,
  resource_id: account.accountUid,
  expires_at: null,
  iban: identifiers?.iban ?? null,
  subtype: account.accountType?.toLowerCase() ?? null,
  bic: identifiers?.bic ?? null,
  routing_number: null,
  wire_routing_number: null,
  account_number: identifiers?.accountIdentifier ?? null,
  sort_code: identifiers?.bankIdentifier ?? null,
  available_balance:
    balance.effectiveBalance?.minorUnits != null
      ? balance.effectiveBalance.minorUnits / MINOR_UNITS
      : null,
  credit_limit: null,
});
