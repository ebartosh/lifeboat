import type { Address, Signature } from "@solana/kit";

/** The parts of a confirmed transaction that describe its balance effects. */
export type ConfirmedTransaction = {
  error: unknown | null;
  feeLamports: bigint;
  accountKeys: readonly Address[];
  preBalances: readonly bigint[];
  postBalances: readonly bigint[];
  preTokenBalances: readonly TokenBalance[];
  postTokenBalances: readonly TokenBalance[];
};
export type TokenBalance = { accountIndex: number; mint: Address; owner?: Address; amount: bigint; decimals: number };

export interface ReceiptRpc {
  getConfirmedTransaction(transactionSignature: Signature): Promise<ConfirmedTransaction | null>;
}

export type TokenChange = { mint: Address; decimals: number; amount: bigint };
/**
 * Balance changes of the wallet's own accounts, read from confirmed transactions. `solChange`
 * includes network fees and any account rent paid or refunded. Informational only: it is read
 * after the result is known and never decides an operation's outcome.
 */
export type TransactionReceipt = {
  transactions: number; failed: number; feeLamports: bigint; solChange: bigint; tokens: TokenChange[];
};

export function walletReceipt(wallet: Address, transactions: readonly ConfirmedTransaction[]): TransactionReceipt {
  let feeLamports = 0n, solChange = 0n, failed = 0;
  const tokens = new Map<Address, TokenChange>();
  for (const transaction of transactions) {
    feeLamports += transaction.feeLamports;
    if (transaction.error !== null) failed++;
    const index = transaction.accountKeys.indexOf(wallet);
    if (index >= 0) solChange += (transaction.postBalances[index] ?? 0n) - (transaction.preBalances[index] ?? 0n);
    // An account created or closed in the transaction appears on one side only.
    const accounts = new Map<number, { mint: Address; decimals: number; pre: bigint; post: bigint }>();
    for (const [side, balances] of [['pre', transaction.preTokenBalances], ['post', transaction.postTokenBalances]] as const) {
      for (const balance of balances) {
        if (balance.owner !== wallet) continue;
        const account = accounts.get(balance.accountIndex) ?? { mint: balance.mint, decimals: balance.decimals, pre: 0n, post: 0n };
        account[side] = balance.amount;
        accounts.set(balance.accountIndex, account);
      }
    }
    for (const account of accounts.values()) {
      const previous = tokens.get(account.mint);
      tokens.set(account.mint, { mint: account.mint, decimals: account.decimals,
        amount: (previous?.amount ?? 0n) + account.post - account.pre });
    }
  }
  return { transactions: transactions.length, failed, feeLamports, solChange,
    tokens: [...tokens.values()].filter(token => token.amount !== 0n) };
}

/**
 * Reads every signature through the operation's RPC. A node can report a signature as confirmed
 * shortly before it serves the full transaction, so missing transactions are retried briefly.
 */
export async function readTransactionReceipt(rpc: ReceiptRpc, wallet: Address, signatures: readonly Signature[], options: {
  attempts?: number; delayMs?: number; sleep?: (milliseconds: number) => Promise<void>;
} = {}): Promise<TransactionReceipt | null> {
  const attempts = options.attempts ?? 3, delayMs = options.delayMs ?? 1_500;
  const sleep = options.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  const found = new Map<Signature, ConfirmedTransaction>();
  for (let attempt = 1; ; attempt++) {
    const missing = signatures.filter(signature => !found.has(signature));
    const results = await Promise.all(missing.map(signature => rpc.getConfirmedTransaction(signature)));
    results.forEach((transaction, i) => { if (transaction) found.set(missing[i]!, transaction); });
    if (found.size === signatures.length) return walletReceipt(wallet, signatures.map(signature => found.get(signature)!));
    if (attempt >= attempts) return null;
    await sleep(delayMs);
  }
}
