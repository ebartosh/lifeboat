import { AccountRole, address, getAddressEncoder, getProgramDerivedAddress, type Address, type Instruction } from '@solana/kit';
import type { AccountReader, ChainAccount } from '../core/accounts';
import { VerificationError } from '../core/errors';

// ore-stake is a separate program from the ORE miner and ore-lst programs.
export const STAKE_PROGRAM = address('stakecNP3FpiExZPCgZfqRgumVzi6dNqnfrjwXyTgeH');
export const ORE_MINT = address('oreoU2P8bN6jkk3jbaiVxYnG1dCXcYxwhwyK9jSybcp');
const TOKEN_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM = address('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const SYSTEM_PROGRAM = address('11111111111111111111111111111111');
const encoder = getAddressEncoder();
const U64_MAX = (1n << 64n) - 1n;

// steel accounts: an 8-byte discriminator (one tag byte, seven zero bytes) followed by the repr(C) struct.
const STAKE_DISCRIMINATOR = 108;
const TREASURY_DISCRIMINATOR = 104;
const STAKE_SIZE = 8 + 112;
const TREASURY_SIZE = 8 + 24;

/** Recorded fields of one Stake account; `rewardsFactor` is the raw I80F48 bit pattern. */
export type StakeAccount = { balance: bigint; rewardsFactor: bigint; rewards: bigint; lifetimeRewards: bigint };

export type StakePosition = StakeAccount & {
  wallet: Address; stakeAddress: Address; available: bigint;
  /** Recorded plus accrued rewards; excludes ORE still vesting into the treasury, so never above the payout. */
  claimable: bigint;
  stakeTokenAddress: Address; recipient: Address; recipientExists: boolean;
};

export async function stakePda(wallet: Address): Promise<Address> {
  return (await getProgramDerivedAddress({ programAddress: STAKE_PROGRAM,
    seeds: [new TextEncoder().encode('stake'), encoder.encode(wallet)] }))[0];
}

async function singleton(seed: string): Promise<Address> {
  return (await getProgramDerivedAddress({ programAddress: STAKE_PROGRAM,
    seeds: [new TextEncoder().encode(seed)] }))[0];
}

export async function oreAta(owner: Address): Promise<Address> {
  return (await getProgramDerivedAddress({ programAddress: ASSOCIATED_TOKEN_PROGRAM,
    seeds: [encoder.encode(owner), encoder.encode(TOKEN_PROGRAM), encoder.encode(ORE_MINT)] }))[0];
}

function u64(data: Uint8Array, offset: number): bigint {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(offset, true);
}

function i128(data: Uint8Array, offset: number): bigint {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return (view.getBigInt64(offset + 8, true) << 64n) | view.getBigUint64(offset, true);
}

function hasDiscriminator(data: Uint8Array, tag: number): boolean {
  return data[0] === tag && data.subarray(1, 8).every(byte => byte === 0);
}

export function parseStakeAccount(account: ChainAccount, wallet: Address): StakeAccount {
  if (account.owner !== STAKE_PROGRAM || account.executable || account.data.length !== STAKE_SIZE ||
      !hasDiscriminator(account.data, STAKE_DISCRIMINATOR) ||
      !encoder.encode(wallet).every((byte, i) => account.data[i + 8] === byte)) {
    throw new VerificationError('Stake account has an unexpected owner, discriminator, layout or authority');
  }
  // Stake: authority 8, balance 40, compound fields and timestamps 48..88, rewards_factor 88, rewards 104, lifetime 112.
  return { balance: u64(account.data, 40), rewardsFactor: i128(account.data, 88),
    rewards: u64(account.data, 104), lifetimeRewards: u64(account.data, 112) };
}

function parseTreasuryFactor(account: ChainAccount | null): bigint {
  if (!account || account.owner !== STAKE_PROGRAM || account.executable || account.data.length !== TREASURY_SIZE ||
      !hasDiscriminator(account.data, TREASURY_DISCRIMINATOR)) {
    throw new VerificationError('The ore-stake treasury is missing or has an unexpected layout');
  }
  return i128(account.data, 8);
}

/**
 * Mirrors Stake::update_rewards without the vesting step: floor((treasury − stake factor) × balance).
 * I80F48 × an integer is exact, so the only rounding is the program's own floor.
 */
export function estimateClaimable(stake: StakeAccount, treasuryFactor: bigint): bigint {
  const accrued = treasuryFactor > stake.rewardsFactor
    ? ((treasuryFactor - stake.rewardsFactor) * stake.balance) >> 48n : 0n;
  return stake.rewards + accrued;
}

export function parseOreAmount(input: string): bigint {
  const match = /^(?:0|[1-9]\d*)(?:\.(\d{1,11}))?$/.exec(input.trim());
  if (!match) throw new VerificationError('Enter an ORE amount with up to 11 decimal places');
  const [whole] = input.trim().split('.');
  const amount = BigInt(whole) * 100_000_000_000n + BigInt((match[1] ?? '').padEnd(11, '0') || '0');
  if (amount === 0n) throw new VerificationError('The withdrawal amount must be greater than zero');
  if (amount > U64_MAX) throw new VerificationError('The amount exceeds the u64 range');
  return amount;
}

export async function readStakePosition(reader: AccountReader, wallet: Address): Promise<StakePosition | null> {
  const [stakeAddress, recipient, program] = await Promise.all([
    stakePda(wallet), oreAta(wallet), reader.getAccount(STAKE_PROGRAM),
  ]);
  if (!program?.executable) throw new VerificationError('The ore-stake program is missing on the selected network');
  const [account, stakeTokenAddress] = await Promise.all([reader.getAccount(stakeAddress), oreAta(stakeAddress)]);
  if (!account) return null;
  const stake = parseStakeAccount(account, wallet);
  const { balance } = stake;
  const treasuryFactor = parseTreasuryFactor(await reader.getAccount(await singleton('treasury')));
  const reserve = await reader.getAccount(stakeTokenAddress);
  if (!reserve || reserve.owner !== TOKEN_PROGRAM || reserve.data.length !== 165 ||
      !encoder.encode(ORE_MINT).every((byte, i) => reserve.data[i] === byte) ||
      !encoder.encode(stakeAddress).every((byte, i) => reserve.data[i + 32] === byte)) {
    throw new VerificationError('Stake token account is missing or invalid');
  }
  const tokenBalance = u64(reserve.data, 64);
  if (tokenBalance < balance) throw new VerificationError('Stake token reserves are insufficient');
  const recipientAccount = await reader.getAccount(recipient);
  if (recipientAccount && (recipientAccount.owner !== TOKEN_PROGRAM || recipientAccount.data.length !== 165 ||
      !encoder.encode(ORE_MINT).every((byte, i) => recipientAccount.data[i] === byte) ||
      !encoder.encode(wallet).every((byte, i) => recipientAccount.data[i + 32] === byte))) {
    throw new VerificationError('Recipient ORE token account is invalid');
  }
  return { ...stake, wallet, stakeAddress, available: balance, claimable: estimateClaimable(stake, treasuryFactor),
    stakeTokenAddress, recipient, recipientExists: !!recipientAccount };
}

export async function buildWithdraw(position: StakePosition, amount: bigint): Promise<Instruction> {
  if (amount <= 0n || amount > U64_MAX || amount > position.available) {
    throw new VerificationError('The withdrawal amount is missing or exceeds the available deposit');
  }
  const data = new Uint8Array(9);
  data[0] = 11;
  new DataView(data.buffer).setBigUint64(1, amount, true);
  return { programAddress: STAKE_PROGRAM, data, accounts: [
    { address: position.wallet, role: AccountRole.WRITABLE_SIGNER },
    { address: ORE_MINT, role: AccountRole.READONLY },
    { address: position.recipient, role: AccountRole.WRITABLE },
    { address: position.stakeAddress, role: AccountRole.WRITABLE },
    { address: position.stakeTokenAddress, role: AccountRole.WRITABLE },
    { address: await singleton('treasury'), role: AccountRole.WRITABLE },
    { address: await singleton('vesting'), role: AccountRole.WRITABLE },
    { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
    { address: TOKEN_PROGRAM, role: AccountRole.READONLY },
    { address: ASSOCIATED_TOKEN_PROGRAM, role: AccountRole.READONLY },
    { address: STAKE_PROGRAM, role: AccountRole.READONLY },
  ] };
}

/**
 * Claim = 12 with amount u64::MAX: the program pays min(amount, rewards), i.e. everything accrued when it
 * executes. Only the signer can lower its own rewards, so the payout is never below the simulated one.
 */
export async function buildClaim(position: StakePosition): Promise<Instruction> {
  const treasury = await singleton('treasury');
  const data = new Uint8Array(9);
  data[0] = 12;
  new DataView(data.buffer).setBigUint64(1, U64_MAX, true);
  return { programAddress: STAKE_PROGRAM, data, accounts: [
    { address: position.wallet, role: AccountRole.WRITABLE_SIGNER },
    { address: ORE_MINT, role: AccountRole.READONLY },
    { address: position.recipient, role: AccountRole.WRITABLE },
    { address: position.stakeAddress, role: AccountRole.WRITABLE },
    { address: treasury, role: AccountRole.WRITABLE },
    { address: await oreAta(treasury), role: AccountRole.WRITABLE },
    { address: await singleton('vesting'), role: AccountRole.WRITABLE },
    { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
    { address: TOKEN_PROGRAM, role: AccountRole.READONLY },
    { address: ASSOCIATED_TOKEN_PROGRAM, role: AccountRole.READONLY },
    { address: STAKE_PROGRAM, role: AccountRole.READONLY },
  ] };
}
