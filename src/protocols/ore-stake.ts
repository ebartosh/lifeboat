import { AccountRole, address, getAddressEncoder, getProgramDerivedAddress, type Address, type Instruction } from '@solana/kit';
import type { AccountReader } from '../core/accounts';
import { VerificationError } from '../core/errors';

// ore-stake is a separate program from the ORE miner and ore-lst programs.
export const STAKE_PROGRAM = address('stakecNP3FpiExZPCgZfqRgumVzi6dNqnfrjwXyTgeH');
export const ORE_MINT = address('oreoU2P8bN6jkk3jbaiVxYnG1dCXcYxwhwyK9jSybcp');
const TOKEN_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM = address('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const SYSTEM_PROGRAM = address('11111111111111111111111111111111');
const encoder = getAddressEncoder();
const U64_MAX = (1n << 64n) - 1n;

export type StakePosition = {
  wallet: Address; stakeAddress: Address; balance: bigint; available: bigint;
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
  const [stake, stakeTokenAddress] = await Promise.all([reader.getAccount(stakeAddress), oreAta(stakeAddress)]);
  if (!stake) return null;
  // steel account!(OreAccount, Stake): one-byte discriminator 108 followed by repr(C) Stake (112 bytes).
  if (stake.owner !== STAKE_PROGRAM || stake.executable || stake.data.length !== 113 || stake.data[0] !== 108 ||
      !encoder.encode(wallet).every((byte, i) => stake.data[i + 1] === byte)) {
    throw new VerificationError('Stake account has an unexpected owner, discriminator, layout or authority');
  }
  const balance = u64(stake.data, 33);
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
  return { wallet, stakeAddress, balance, available: balance, stakeTokenAddress,
    recipient, recipientExists: !!recipientAccount };
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
