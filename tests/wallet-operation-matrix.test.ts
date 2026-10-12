import { address, blockhash, getSignatureFromTransaction, type Instruction, type Transaction } from '@solana/kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeSafeTransaction } from '../src/core/transaction';
import { checkTransactionSignatures } from '../src/core/signed-transaction';
import { createOreAdapter } from '../src/protocols/ore-bundle';
import { buildClaim, buildWithdraw, oreAta, stakePda, type StakePosition } from '../src/protocols/ore-stake';
import { prepareOperation } from '../src/protocols/kamino/operations';
import { executeMeteoraWithRpc } from '../src/operations/meteora';
import { fixture as kaminoFixture, POSITION as KAMINO_POSITION, WSOL } from './fixtures/kamino';
import { meteoraFixture, POSITION as METEORA_POSITION } from './fixtures/meteora';
import { createTestSigner } from './fixtures/signer';
import { signWithAdditions } from './fixtures/wallet-additions';

beforeEach(() => vi.spyOn(console, 'info').mockImplementation(() => undefined));
afterEach(() => vi.restoreAllMocks());

describe('actual operation messages with modeled Solflare additions', () => {
  it.each(['Claim SOL', 'Claim ORE', 'Unstake ORE', 'Claim staking rewards'])('preserves %s and verifies its wallet signature', async operation => {
    const signer = await createTestSigner(), ore = createOreAdapter();
    const stake: StakePosition = { wallet: signer.address, stakeAddress: await stakePda(signer.address), balance: 100n, available: 100n,
      rewardsFactor: 0n, rewards: 5n, lifetimeRewards: 5n, claimable: 5n,
      stakeTokenAddress: await oreAta(await stakePda(signer.address)), recipient: await oreAta(signer.address), recipientExists: true };
    const instructions: Instruction[] = [operation === 'Claim SOL' ? await ore.buildClaimSolInstruction(signer.address)
      : operation === 'Claim ORE' ? await ore.buildClaimOreInstruction(signer.address)
      : operation === 'Unstake ORE' ? await buildWithdraw(stake, 10n) : await buildClaim(stake)];
    const sent: Transaction[] = [];
    const result = await executeSafeTransaction({ wallet: signer.address, instructions,
      rpc: { getLatestBlockhash: async () => ({ blockhash: blockhash('11111111111111111111111111111111'), lastValidBlockHeight: 100n }),
        getBlockHeight: async () => 1n, simulateTransaction: async () => ({ error: null, logs: [] }),
        getTransactionFee: async () => 29000n, sendTransaction: async tx => { sent.push(tx); return getSignatureFromTransaction(tx); },
        getSignatureStatus: async () => ({ confirmationStatus: 'confirmed', error: null }) },
      signWithWallet: tx => signWithAdditions(tx, signer), confirm: async () => true });
    expect(result.status).toBe('confirmed'); expect(sent).toHaveLength(1);
    expect(await checkTransactionSignatures(sent[0], [signer.address])).toBeNull();
  });
  it.each(['withdraw', 'repay', 'repay-SOL'] as const)('preserves a real Kamino %s plan, including temporary signers', async action => {
    const f = await kaminoFixture(action === 'repay-SOL' ? { reserve: WSOL, debt: 100_000_000n, missingAta: true } : {});
    const plan = await prepareOperation({ action: action === 'withdraw' ? 'withdraw' : 'repay', adapter: f.adapter, rpc: f.rpc,
      wallet: f.wallet.address, position: KAMINO_POSITION, token: action === 'repay-SOL' ? 'SOL' : 'USDC', amount: '0.001' });
    expect(plan).toBeDefined(); const sent: Transaction[] = [];
    const rpc = { getLatestBlockhash: () => f.rpc.getLatestBlockhash(), getBlockHeight: () => f.rpc.getBlockHeight(),
      simulateTransaction: async () => ({ error: null, logs: [] }), getTransactionFee: async () => 34000n,
      sendTransaction: async (tx: Transaction) => { sent.push(tx); return getSignatureFromTransaction(tx); },
      getSignatureStatus: async () => ({ confirmationStatus: 'confirmed' as const, error: null }) };
    const result = await executeSafeTransaction({ wallet: f.wallet.address, rpc, instructions: plan!.instructions,
      additionalSigners: plan!.additionalSigners, signWithWallet: tx => signWithAdditions(tx, f.wallet), confirm: async () => true });
    expect(result.status).toBe('confirmed'); expect(sent).toHaveLength(1);
    expect(await checkTransactionSignatures(sent[0], [f.wallet.address, ...(plan!.additionalSigners ?? []).map(s => s.address)])).toBeNull();
    if (action === 'repay-SOL') expect(plan!.additionalSigners).toHaveLength(1);
  });
  it('runs a packed Meteora remove, fee, reward and close step with updated wallet messages and fresh simulation postconditions', async () => {
    const f = await meteoraFixture({ width: 10, reward: true }); f.rpc.fee = 19000n; let approvals = 0;
    const result = await executeMeteoraWithRpc(f.rpc, { wallet: f.signer.address,
      signWithWallet: tx => signWithAdditions(tx, f.signer, 1_400_000n, 10_000n),
      operation: { version: 1, id: 'wallet-matrix', wallet: f.signer.address, position: METEORA_POSITION,
        rpcUrl: 'https://example.com', createdAt: 1, completed: [] },
      confirm: async () => { approvals++; return true; }, beforeSend: async () => undefined, confirmed: async () => undefined });
    expect(result.status).toBe('confirmed');
    expect(result.operation.completed.map(item => item.step.actions.map(a => a.kind).join('+'))).toEqual(['remove+fees+reward+close']);
    expect(approvals).toBe(2);
    for (const sent of f.rpc.sent) expect(await checkTransactionSignatures(sent, [f.signer.address])).toBeNull();
  });
});
