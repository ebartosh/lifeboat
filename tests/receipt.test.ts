import { address, type Signature } from '@solana/kit';
import { describe, expect, it, vi } from 'vitest';
import { readTransactionReceipt, walletReceipt, type ConfirmedTransaction } from '../src/core/receipt';

const wallet = address('11111111111111111111111111111112');
const other = address('11111111111111111111111111111113');
const usdc = address('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const wsol = address('So11111111111111111111111111111111111111112');
const signature = (n: number) => String(n).repeat(64) as Signature;
const transaction = (changes: Partial<ConfirmedTransaction> = {}): ConfirmedTransaction => ({
  error: null, feeLamports: 5_000n, accountKeys: [wallet, other],
  preBalances: [1_000_000n, 0n], postBalances: [995_000n, 0n], preTokenBalances: [], postTokenBalances: [], ...changes,
});

describe('wallet receipt from confirmed transactions', () => {
  it('measures only the wallet-owned token accounts, including created and closed ones', () => {
    const receipt = walletReceipt(wallet, [transaction({
      // Account 2 existed before; account 3 was created; account 4 (WSOL) was closed; account 5 belongs to someone else.
      preTokenBalances: [
        { accountIndex: 2, mint: usdc, owner: wallet, amount: 100n, decimals: 6 },
        { accountIndex: 4, mint: wsol, owner: wallet, amount: 7n, decimals: 9 },
        { accountIndex: 5, mint: usdc, owner: other, amount: 900n, decimals: 6 },
      ],
      postTokenBalances: [
        { accountIndex: 2, mint: usdc, owner: wallet, amount: 150n, decimals: 6 },
        { accountIndex: 3, mint: usdc, owner: wallet, amount: 25n, decimals: 6 },
        { accountIndex: 5, mint: usdc, owner: other, amount: 825n, decimals: 6 },
      ],
    })]);
    expect(receipt).toEqual({ transactions: 1, failed: 0, feeLamports: 5_000n, solChange: -5_000n,
      tokens: [{ mint: usdc, decimals: 6, amount: 75n }, { mint: wsol, decimals: 9, amount: -7n }] });
  });
  it('sums several transactions and drops tokens whose net change is zero', () => {
    const balance = (amount: bigint) => [{ accountIndex: 2, mint: usdc, owner: wallet, amount, decimals: 6 }];
    const receipt = walletReceipt(wallet, [
      transaction({ preTokenBalances: balance(10n), postTokenBalances: balance(20n) }),
      transaction({ preTokenBalances: balance(20n), postTokenBalances: balance(10n), postBalances: [3_000_000n, 0n] }),
      transaction({ error: { InstructionError: [0, 'Custom'] } }),
    ]);
    expect(receipt).toEqual({ transactions: 3, failed: 1, feeLamports: 15_000n, solChange: 1_990_000n, tokens: [] });
  });
});

describe('reading a receipt through the RPC', () => {
  it('retries signatures that the RPC does not serve yet', async () => {
    const getConfirmedTransaction = vi.fn<(s: Signature) => Promise<ConfirmedTransaction | null>>()
      .mockResolvedValueOnce(transaction()).mockResolvedValueOnce(null).mockResolvedValueOnce(transaction());
    const sleep = vi.fn(async () => {});
    const receipt = await readTransactionReceipt({ getConfirmedTransaction }, wallet, [signature(1), signature(2)], { sleep });
    expect(receipt?.transactions).toBe(2);
    expect(getConfirmedTransaction.mock.calls.map(([s]) => s)).toEqual([signature(1), signature(2), signature(2)]);
    expect(sleep).toHaveBeenCalledTimes(1);
  });
  it('gives up without a partial receipt', async () => {
    const getConfirmedTransaction = vi.fn(async (s: Signature) => s === signature(1) ? transaction() : null);
    expect(await readTransactionReceipt({ getConfirmedTransaction }, wallet, [signature(1), signature(2)],
      { attempts: 2, sleep: async () => {} })).toBeNull();
    expect(getConfirmedTransaction).toHaveBeenCalledTimes(3);
  });
});
