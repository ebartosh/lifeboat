import { getSignatureFromTransaction, type Transaction } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { executeSafeTransaction } from '../src/core/transaction';
import { prepareRepay, prepareWithdraw } from '../src/protocols/kamino/operations';
import { adapter, fixture, obligationBytes, POSITION, tokenBytes, USDC, WSOL } from './fixtures/kamino';
import { TOKEN } from '../src/protocols/kamino/accounts';

describe('Kamino mobile transaction plans', () => {
  it('builds and validates a full ATA repayment before asking for approval', async () => {
    const f = await fixture();
    const plan = (await prepareRepay({ adapter, rpc: f.rpc, wallet: f.wallet.address,
      position: POSITION, token: 'USDC', amount: 'all' }))!;
    expect(plan.additionalSigners).toBeUndefined();
    f.rpc.finalAccounts = [
      { owner: adapter.programAddress, executable: false, data: obligationBytes(f.wallet.address, USDC, 1_000_000_000n, 0n) },
      { owner: TOKEN, executable: false, data: tokenBytes(f.wallet.address, f.mint, 900_000_000n) },
    ];
    const result = await executeSafeTransaction({ rpc: f.rpc, wallet: f.wallet.address,
      getSigner: async () => f.wallet, instructions: plan.instructions,
      simulationAccounts: plan.simulationAccounts, validateSimulation: plan.validateSimulation,
      confirm: async () => { expect(f.rpc.simulations).toHaveLength(1); return false; } });
    expect(result.status).toBe('cancelled');
    expect(f.rpc.sent).toHaveLength(0);
  });

  it('prepares withdrawal with an atomic recipient ATA creation', async () => {
    const f = await fixture({ debt: 0n, missingAta: true });
    const plan = (await prepareWithdraw({ adapter, rpc: f.rpc, wallet: f.wallet.address,
      position: POSITION, token: 'USDC', amount: 'all' }))!;
    expect(plan.createsAta).toBe(true);
    expect(plan.recipient).toBe(f.ata);
    expect(plan.instructions[1]?.data).toEqual(Uint8Array.of(1));
    f.rpc.finalAccounts = [null,
      { owner: TOKEN, executable: false, data: tokenBytes(f.wallet.address, f.mint, plan.estimate) }];
    const result = await executeSafeTransaction({ rpc: f.rpc, wallet: f.wallet.address,
      getSigner: async () => f.wallet, instructions: plan.instructions,
      simulationAccounts: plan.simulationAccounts, validateSimulation: plan.validateSimulation,
      confirm: async () => false });
    expect(result.status).toBe('cancelled');
  });

  it('uses a second signer for native SOL and keeps the simulated message', async () => {
    const f = await fixture({ reserve: WSOL });
    const plan = (await prepareRepay({ adapter, rpc: f.rpc, wallet: f.wallet.address,
      position: POSITION, token: 'SOL', amount: 'all' }))!;
    expect(plan.additionalSigners).toHaveLength(1);
    const post = obligationBytes(f.wallet.address, WSOL, 1_000_000_000n, 0n);
    const walletAccount = f.rpc.accounts.get(f.wallet.address)!;
    const debit = plan.estimate;
    f.rpc.finalAccounts = [
      { owner: adapter.programAddress, executable: false, data: post },
      null,
      ...plan.simulationAccounts.slice(2, -1).map(key => f.rpc.accounts.get(key) ?? null),
      { ...walletAccount, lamports: walletAccount.lamports! - debit - f.rpc.fee! },
    ];
    f.rpc.sendTransaction = async (transaction: Transaction) => {
      f.rpc.sent.push(transaction);
      return getSignatureFromTransaction(transaction);
    };
    const result = await executeSafeTransaction({ rpc: f.rpc, wallet: f.wallet.address,
      getSigner: async () => f.wallet, instructions: plan.instructions,
      simulationAccounts: plan.simulationAccounts, validateSimulation: plan.validateSimulation,
      beforeSimulation: plan.beforeSimulation, additionalSigners: plan.additionalSigners,
      confirm: async () => true });
    expect(result.status).toBe('confirmed');
    expect(f.rpc.simulations).toHaveLength(2);
    expect(f.rpc.sent).toHaveLength(1);
    expect(f.rpc.sent[0]!.messageBytes).toEqual(f.rpc.simulations[1]!.messageBytes);
    expect(plan.nativeSol?.debit).toBe(debit);
  });
});
