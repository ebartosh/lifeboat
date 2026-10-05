import { AccountRole, address, blockhash, getSignatureFromTransaction, type Address, type Transaction } from '@solana/kit';
import { describe, expect, it, vi } from 'vitest';
import { buildWithdraw, oreAta, parseOreAmount, readStakePosition, stakePda, STAKE_PROGRAM, ORE_MINT } from '../src/protocols/ore-stake';
import { unstakeOre } from '../src/operations/unstake';
import { stakeFixture, tokenFixture } from './fixtures/stake';
import { createTestSigner } from './fixtures/signer';

async function setup(balance = 123_456_789_012n) {
  const signer = await createTestSigner();
  const wallet = signer.address;
  const stake = await stakePda(wallet);
  const tokens = await oreAta(stake);
  const recipient = await oreAta(wallet);
  const rpc = {
    getAccount: vi.fn(async (key: Address) => key === STAKE_PROGRAM
      ? { owner: STAKE_PROGRAM, executable: true, data: new Uint8Array() }
      : key === stake ? { owner: STAKE_PROGRAM, executable: false, data: stakeFixture(wallet, balance) }
      : key === tokens ? { owner: address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'), executable: false, data: tokenFixture(stake, balance) }
      : null),
    getLatestBlockhash: vi.fn(async () => ({ blockhash: blockhash('11111111111111111111111111111111'), lastValidBlockHeight: 100n })),
    simulateTransaction: vi.fn(async () => ({ error: null as unknown, logs: [] as string[] })),
    getTransactionFee: vi.fn(async () => 5000n),
    getBlockHeight: vi.fn(async () => 1n),
    sendTransaction: vi.fn(async (tx: Transaction) => getSignatureFromTransaction(tx)),
    getSignatureStatus: vi.fn(async () => ({ confirmationStatus: 'confirmed' as const, error: null as unknown })),
  };
  return { signer, wallet, stake, tokens, recipient, rpc };
}

describe('ore-stake Withdraw', () => {
  it('derives distinct stake PDA and ATA and serializes exact SDK account order', async () => {
    const f = await setup();
    expect(f.stake).toBe('DThSezC8QhsMbRijYXVeTvMa6bWmhW1bhVQeQxfu3y14');
    expect(f.tokens).toBe('DPFv9Eu9NqxbKVfBxJknKUDzLH2CpJvDKctMi2qLbFkX');
    const position = (await readStakePosition(f.rpc, f.wallet))!;
    const ix = await buildWithdraw(position, 100_000_000_001n);
    expect(ix.programAddress).toBe(STAKE_PROGRAM);
    expect(ix.data).toEqual(Uint8Array.from([11, 1, 232, 118, 72, 23, 0, 0, 0]));
    expect(ix.accounts?.map(a => a.role)).toEqual([
      AccountRole.WRITABLE_SIGNER, AccountRole.READONLY, AccountRole.WRITABLE,
      AccountRole.WRITABLE, AccountRole.WRITABLE, AccountRole.WRITABLE,
      AccountRole.WRITABLE, AccountRole.READONLY, AccountRole.READONLY,
      AccountRole.READONLY, AccountRole.READONLY,
    ]);
    expect(ix.accounts?.map(a => a.address)).toEqual([f.wallet, ORE_MINT, f.recipient, f.stake, f.tokens,
      'F3ajpARUkbMnYsrbAmgnsjyp991DVbGYRzfaVXy1Dfvu',
      '8dPF5obsJxPsZeecAFqJbSWPEw9FkR1XGyRSJbry8B21',
      '11111111111111111111111111111111', 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', STAKE_PROGRAM]);
  });
  it('parses ORE exactly and rejects zero, excess precision and u64 overflow', () => {
    expect(parseOreAmount('1.00000000001')).toBe(100_000_000_001n);
    expect(parseOreAmount('0.00000000001')).toBe(1n);
    for (const value of ['0', '0.00000000000', '1.000000000001', '-1', '1e2', '184467441'])
      expect(() => parseOreAmount(value)).toThrow();
  });
  it('checks fresh balance and never signs when insufficient', async () => {
    const f = await setup(1n);
    const getSigner = vi.fn(async () => f.signer);
    await expect(unstakeOre({ rpc: f.rpc, wallet: f.wallet, amount: '1', getSigner,
      confirm: async () => true })).rejects.toThrow('Insufficient');
    expect(f.rpc.getLatestBlockhash).not.toHaveBeenCalled();
    expect(getSigner).not.toHaveBeenCalled();
  });
  it('cancels after simulation without signer or send', async () => {
    const f = await setup(); const getSigner = vi.fn(async () => f.signer);
    const result = await unstakeOre({ rpc: f.rpc, wallet: f.wallet, amount: '1', getSigner,
      confirm: async review => {
        expect(review).toMatchObject({ amount: 100_000_000_000n, recipient: f.recipient,
          wallet: f.wallet, feeLamports: 5000n, recipientExists: false });
        return false;
      } });
    expect(result.status).toBe('cancelled');
    expect(getSigner).not.toHaveBeenCalled(); expect(f.rpc.sendTransaction).not.toHaveBeenCalled();
  });
  it('simulation error never reaches approval or send', async () => {
    const f = await setup(); const confirm = vi.fn(async () => true);
    f.rpc.simulateTransaction.mockResolvedValue({ error: 'failure', logs: [] });
    await expect(unstakeOre({ rpc: f.rpc, wallet: f.wallet, amount: '1', getSigner: async () => f.signer, confirm })).rejects.toThrow('simulation failed');
    expect(confirm).not.toHaveBeenCalled(); expect(f.rpc.sendTransaction).not.toHaveBeenCalled();
  });
});
