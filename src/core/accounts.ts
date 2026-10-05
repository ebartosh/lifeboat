import type { Address } from "@solana/kit";

export type ChainAccount = {
  lamports?: bigint;
  owner: Address;
  executable: boolean;
  data: Uint8Array;
};

export interface AccountReader {
  getAccount(accountAddress: Address): Promise<ChainAccount | null>;
}

export type AccountSnapshot = { slot: bigint; accounts: readonly (ChainAccount | null)[] };
export type AccountFilter = { offset: number; bytes: string };
export interface LendingReader extends AccountReader {
  getAccounts(addresses: readonly Address[], minContextSlot?: bigint): Promise<AccountSnapshot>;
  getProgramAccounts(program: Address, size: number, filters: readonly AccountFilter[]): Promise<{
    slot: bigint; accounts: readonly { address: Address; account: ChainAccount }[];
  }>;
}
export type ManifestAction = { id: string; label: string; description: string; instruction: string };
