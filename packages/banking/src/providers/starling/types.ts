export type StarlingMoney = {
  currency: string;
  minorUnits: number;
};

export type StarlingAccount = {
  accountUid: string;
  accountType: string;
  defaultCategory: string;
  currency: string;
  createdAt: string;
  name: string;
};

export type StarlingBalance = {
  clearedBalance: StarlingMoney;
  effectiveBalance: StarlingMoney;
  pendingTransactions: StarlingMoney;
  availableToSpend?: StarlingMoney;
  acceptedOverdraft?: StarlingMoney;
};

export type StarlingAccountIdentifiers = {
  accountIdentifier?: string;
  bankIdentifier?: string;
  iban?: string;
  bic?: string;
};

export type StarlingFeedItem = {
  feedItemUid: string;
  categoryUid?: string;
  amount: StarlingMoney;
  sourceAmount?: StarlingMoney;
  direction: "IN" | "OUT";
  transactionTime: string;
  settlementTime?: string;
  source?: string;
  sourceSubType?: string;
  status: string;
  counterPartyType?: string;
  counterPartyName?: string;
  counterPartyUid?: string;
  reference?: string;
  country?: string;
  spendingCategory?: string;
};
