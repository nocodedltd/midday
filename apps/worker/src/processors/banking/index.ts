import { SyncBankAccountsProcessor } from "./sync-bank-accounts";

export const bankingProcessors = {
  "sync-bank-accounts": new SyncBankAccountsProcessor(),
};

export { SyncBankAccountsProcessor };
