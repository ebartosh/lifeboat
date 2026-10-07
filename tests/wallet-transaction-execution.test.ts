import { address, blockhash, getSignatureFromTransaction, type Transaction } from '@solana/kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeSafeTransaction, type TransactionReview } from '../src/core/transaction';
import type { SimulationResult } from '../src/core/rpc';
import { checkTransactionSignatures } from '../src/core/signed-transaction';
import { createTestSigner } from './fixtures/signer';
import { signWithAdditions, walletMessage } from './fixtures/wallet-additions';

beforeEach(() => vi.spyOn(console, 'info').mockImplementation(() => undefined));
afterEach(() => vi.restoreAllMocks());
async function fixture() {
  const signer = await createTestSigner(); let height = 1n;
  const rpc = {
    getLatestBlockhash: vi.fn(async () => ({ blockhash: blockhash('11111111111111111111111111111111'), lastValidBlockHeight: 100n })),
    getBlockHeight: vi.fn(async () => height),
    simulateTransaction: vi.fn(async (): Promise<SimulationResult> => ({ error: null, logs: [], unitsConsumed: 20n })),
    getTransactionFee: vi.fn(async (): Promise<bigint | null> => rpc.simulateTransaction.mock.calls.length > 1 ? 29000n : 5000n),
    sendTransaction: vi.fn(async (tx: Transaction) => getSignatureFromTransaction(tx)),
    getSignatureStatus: vi.fn(async () => ({ confirmationStatus: 'confirmed' as const, error: null })),
  };
  const confirm = vi.fn(async (_review: TransactionReview) => true), beforeSend = vi.fn(async () => undefined);
  return { signer, rpc, confirm, beforeSend, expire: () => { height = 101n; }, options: {
    rpc, wallet: signer.address, instruction: { programAddress: address('11111111111111111111111111111111'), data: Uint8Array.of(7) },
    signWithWallet: (tx: Transaction) => signWithAdditions(tx, signer), confirm, beforeSend,
  } };
}
describe('wallet additions execution', () => {
  it('verifies and re-simulates the signed version, re-runs postconditions, then gets approval of its actual fee', async () => {
    const f = await fixture(); const validateSimulation = vi.fn(async () => undefined);
    const beforeSimulation = vi.fn(async () => undefined);
    expect((await executeSafeTransaction({ ...f.options, validateSimulation, beforeSimulation })).status).toBe('confirmed');
    expect(beforeSimulation).toHaveBeenCalledTimes(2);
    expect(validateSimulation).toHaveBeenCalledTimes(2);
    expect(f.confirm).toHaveBeenCalledTimes(2);
    expect(f.confirm.mock.calls[0][0].walletChanges).toBeUndefined();
    expect(f.confirm.mock.calls[1][0]).toMatchObject({ feeLamports: 29000n, walletChanges: { priorityFeeLamports: 24000n, assertionCount: 1 } });
    expect(f.rpc.sendTransaction).toHaveBeenCalledTimes(1);
    const sent = f.rpc.sendTransaction.mock.calls[0][0];
    expect(await checkTransactionSignatures(sent, [f.signer.address])).toBeNull();
    expect(f.beforeSend).toHaveBeenCalledTimes(1);
  });
  it.each(['simulation', 'postcondition', 'fee', 'fee-null', 'fee-inconsistent', 'signature', 'unknown-addition', 'second-review', 'expiry'])(
    'does not send after %s failure or rejection', async kind => {
      const f = await fixture(); let validations = 0;
      const options = { ...f.options, validateSimulation: async () => {
        if (++validations === 2 && kind === 'postcondition') throw new Error('Receipt changed');
      } };
      if (kind === 'simulation') f.rpc.simulateTransaction.mockResolvedValueOnce({ error: null, logs: [] }).mockResolvedValueOnce({ error: 'assertion failed', logs: [] });
      if (kind === 'fee') f.rpc.getTransactionFee.mockResolvedValueOnce(5000n).mockRejectedValueOnce(new Error('Fee RPC unavailable'));
      if (kind === 'fee-null') f.rpc.getTransactionFee.mockResolvedValueOnce(5000n).mockResolvedValueOnce(null);
      if (kind === 'fee-inconsistent') f.rpc.getTransactionFee.mockResolvedValueOnce(5000n).mockResolvedValueOnce(1n);
      if (kind === 'signature') options.signWithWallet = async tx => {
        const signed = await signWithAdditions(tx, f.signer);
        return { ...signed, signatures: { [f.signer.address]: new Uint8Array(64).fill(1) } } as unknown as Transaction;
      };
      if (kind === 'unknown-addition') options.signWithWallet = async tx => walletMessage(tx, ix => [...ix, { programAddress: address('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'), data: Uint8Array.of(1) }]);
      if (kind === 'second-review') f.confirm.mockImplementation(async review => !review.walletChanges);
      if (kind === 'expiry') f.confirm.mockImplementation(async review => { if (review.walletChanges) f.expire(); return true; });
      if (kind === 'second-review') expect(await executeSafeTransaction(options)).toEqual({ status: 'cancelled' });
      else await expect(executeSafeTransaction(options)).rejects.toThrow();
      expect(f.rpc.sendTransaction).not.toHaveBeenCalled();
      if (kind !== 'expiry') expect(f.beforeSend).not.toHaveBeenCalled();
    });
});
