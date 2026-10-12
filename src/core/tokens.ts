import { AccountRole, address, getAddressDecoder, getAddressEncoder, getProgramDerivedAddress, type Address, type Instruction } from '@solana/kit';
import type { ChainAccount } from './accounts';
import { VerificationError } from './errors';

export const TOKEN_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const TOKEN_2022_PROGRAM = address('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
export const ASSOCIATED_TOKEN_PROGRAM = address('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
export const NATIVE_TOKEN_2022_MINT = address('9pan9bMn5HatX4EJdBwg9VgCa7Uz5HL8N1m5D3NdXejP');
const SYSTEM = address('11111111111111111111111111111111');
const U64_MAX = (1n << 64n) - 1n;
export type TokenProgram = typeof TOKEN_PROGRAM | typeof TOKEN_2022_PROGRAM;
function requireToken(value: unknown, reason: string): asserts value {
  if (!value) throw new VerificationError(`Token: ${reason}`);
}
const view = (d: Uint8Array) => new DataView(d.buffer, d.byteOffset, d.byteLength);
const key = (d: Uint8Array, offset: number) => getAddressDecoder().decode(d.subarray(offset, offset + 32));
const option = (d: Uint8Array, offset: number) => {
  const n = view(d).getUint32(offset, true);
  requireToken(n === 0 || n === 1, 'invalid authority/native option'); return n;
};
const names = ['Uninitialized', 'TransferFeeConfig', 'TransferFeeAmount', 'MintCloseAuthority',
  'ConfidentialTransferMint', 'ConfidentialTransferAccount', 'DefaultAccountState', 'ImmutableOwner',
  'MemoTransfer', 'NonTransferable', 'InterestBearingConfig', 'CpiGuard', 'PermanentDelegate',
  'NonTransferableAccount', 'TransferHook', 'TransferHookAccount', 'ConfidentialTransferFeeConfig',
  'ConfidentialTransferFeeAmount', 'MetadataPointer', 'TokenMetadata', 'GroupPointer', 'TokenGroup',
  'GroupMemberPointer', 'TokenGroupMember', 'ConfidentialMintBurn', 'ScaledUiAmountConfig',
  'PausableConfig', 'PausableAccount', 'PermissionedBurn'];
const accountTypes = new Set([2, 5, 7, 8, 11, 13, 15, 17, 27]);
const fixedLengths: Record<number, number> = { 1:108, 2:8, 3:32, 4:65, 5:295, 6:1, 7:0, 8:1,
  9:0, 10:52, 11:1, 12:32, 13:0, 14:64, 15:1, 18:64, 20:64, 21:80, 22:64, 23:72,
  25:56, 26:33, 27:0, 28:32 };
export type TokenExtension = { type: number; name: string; data: Uint8Array; known: boolean };
/** Strict TLV framing; unknown types are retained for protocol-specific rejection. */
function extensions(account: ChainAccount, kind: 'mint' | 'account'): TokenExtension[] {
  const d = account.data, base = kind === 'mint' ? 82 : 165;
  requireToken(d.length >= base, `truncated ${kind}`);
  if (account.owner === TOKEN_PROGRAM) {
    requireToken(d.length === base, `ordinary SPL ${kind} has unexpected length`); return [];
  }
  if (d.length === base) return [];
  requireToken(d.length >= 166 && d.length !== 355 && d[165] === (kind === 'mint' ? 1 : 2), `invalid extended ${kind} length/type`);
  if (kind === 'mint') requireToken(d.subarray(82, 165).every(b => b === 0), 'nonzero mint padding');
  const result: TokenExtension[] = [], seen = new Set<number>();
  for (let offset = 166; offset < d.length;) {
    // Token-2022 reallocations may leave zero allocation at the end.
    if (d.subarray(offset).every(b => b === 0)) break;
    requireToken(offset + 4 <= d.length, 'truncated extension header');
    const type = view(d).getUint16(offset, true), length = view(d).getUint16(offset + 2, true);
    requireToken(type !== 0 && !seen.has(type), 'uninitialized or duplicate extension');
    requireToken(offset + 4 + length <= d.length, 'truncated extension payload');
    const known = names[type] !== undefined;
    if (known) requireToken(accountTypes.has(type) === (kind === 'account'), `${names[type]} is not a ${kind} extension`);
    if (fixedLengths[type] !== undefined) requireToken(length === fixedLengths[type], `invalid ${names[type]} length`);
    result.push({type, name:names[type] ?? `Unknown extension ${type}`, known, data:d.slice(offset + 4, offset + 4 + length)});
    seen.add(type); offset += 4 + length;
  }
  return result;
}
function verifiedProgram(account: ChainAccount | null | undefined): asserts account is ChainAccount & {owner: TokenProgram} {
  requireToken(account && !account.executable && (account.owner === TOKEN_PROGRAM || account.owner === TOKEN_2022_PROGRAM), 'missing account or invalid token program owner/type');
}
export type TransferFee = { epoch: bigint; maximumFee: bigint; basisPoints: number };
export type TransferFeeConfig = { older: TransferFee; newer: TransferFee; withheldAmount: bigint };
function fee(d: Uint8Array, offset: number): TransferFee {
  const v = view(d), basisPoints = v.getUint16(offset + 16, true);
  requireToken(basisPoints <= 10_000, 'invalid transfer fee basis points');
  return {epoch:v.getBigUint64(offset, true), maximumFee:v.getBigUint64(offset + 8, true), basisPoints};
}
// TokenMetadata is variable-length Borsh, unlike the fixed-size extension PODs.
function validateMetadata(d: Uint8Array, mint: Address) {
  requireToken(d.length >= 80 && key(d, 32) === mint, 'TokenMetadata mint mismatch or truncated data');
  let offset = 64;
  const string = () => {
    requireToken(offset + 4 <= d.length, 'truncated TokenMetadata string');
    const length = view(d).getUint32(offset, true); offset += 4;
    requireToken(offset + length <= d.length, 'truncated TokenMetadata string');
    // Validate UTF-8 without a Node Buffer or native TextDecoder dependency.
    const end = offset + length;
    while (offset < end) {
      const first = d[offset++]!;
      if (first < 128) continue;
      const count = first >= 194 && first <= 223 ? 1 : first >= 224 && first <= 239 ? 2 : first >= 240 && first <= 244 ? 3 : -1;
      requireToken(count >= 0 && offset + count <= end, 'invalid TokenMetadata UTF-8');
      const second = d[offset]!;
      requireToken(!(first === 224 && second < 160) && !(first === 237 && second >= 160)
        && !(first === 240 && second < 144) && !(first === 244 && second >= 144), 'invalid TokenMetadata UTF-8');
      for (let i = 0; i < count; i++) requireToken((d[offset++]! & 192) === 128, 'invalid TokenMetadata UTF-8');
    }
  };
  string(); string(); string();
  requireToken(offset + 4 <= d.length, 'truncated TokenMetadata fields');
  const count = view(d).getUint32(offset, true); offset += 4;
  requireToken(count <= Math.floor((d.length - offset) / 8), 'invalid TokenMetadata field count');
  for (let i = 0; i < count; i++) { string(); string(); }
  requireToken(offset === d.length, 'trailing TokenMetadata data');
}
export type TokenMint = { address: Address; program: TokenProgram; decimals: number; supply: bigint;
  mintAuthority: Address | null; freezeAuthority: Address | null; extensions: TokenExtension[];
  transferFee: TransferFeeConfig | null; transferHookProgram: Address | null };
export function decodeTokenMint(mint: Address, account: ChainAccount | null | undefined): TokenMint {
  verifiedProgram(account);
  const exts = extensions(account, 'mint'), d = account.data;
  requireToken(d[45] === 1, 'mint is uninitialized');
  const mintAuthority = option(d, 0) ? key(d, 4) : null, freezeAuthority = option(d, 46) ? key(d, 50) : null;
  const config = exts.find(e => e.type === 1)?.data;
  const transferFee = config ? {older:fee(config, 72), newer:fee(config, 90), withheldAmount:view(config).getBigUint64(64, true)} : null;
  if (transferFee) requireToken(transferFee.newer.epoch >= transferFee.older.epoch, 'invalid transfer fee epochs');
  const metadata = exts.find(e => e.type === 19); if (metadata) validateMetadata(metadata.data, mint);
  const hook = exts.find(e => e.type === 14)?.data;
  return {address:mint, program:account.owner, decimals:d[44]!, supply:view(d).getBigUint64(36, true), mintAuthority, freezeAuthority,
    extensions:exts, transferFee, transferHookProgram:hook && key(hook, 32) !== SYSTEM ? key(hook, 32) : null};
}
export const TOKEN_METADATA_PROGRAM = address('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
/** Metaplex metadata PDA. Its name and symbol are stored on-chain; only the uri JSON is off-chain. */
export async function metaplexMetadataAddress(mint: Address) {
  const encode = (a: Address) => getAddressEncoder().encode(a);
  return (await getProgramDerivedAddress({programAddress:TOKEN_METADATA_PROGRAM, seeds:['metadata', encode(TOKEN_METADATA_PROGRAM), encode(mint)]}))[0];
}
const hiddenCharacter = (c: number) => c < 0x20 || (c >= 0x7f && c <= 0x9f) || (c >= 0x200b && c <= 0x200f)
  || (c >= 0x2028 && c <= 0x202e) || (c >= 0x2060 && c <= 0x2069) || c === 0xfeff;
// Reads the Borsh symbol that follows the name. Metaplex pads both with NUL bytes.
function symbolAfterName(d: Uint8Array, offset: number): string | null {
  if (offset + 4 > d.length) return null;
  offset += 4 + view(d).getUint32(offset, true);
  if (offset + 4 > d.length) return null;
  const length = view(d).getUint32(offset, true); offset += 4;
  if (length > 64 || offset + length > d.length) return null;
  let text: string;
  // Decodes UTF-8 without a native TextDecoder; invalid sequences throw.
  try { text = decodeURIComponent(Array.from(d.subarray(offset, offset + length), b => `%${b.toString(16).padStart(2, '0')}`).join('')); }
  catch { return null; }
  text = text.replace(/\0+$/, '').trim();
  // Control, invisible and bidirectional characters could disguise the label.
  return text && text.length <= 16 && ![...text].some(c => hiddenCharacter(c.codePointAt(0)!)) ? text : null;
}
/** Display label only: the Token-2022 TokenMetadata symbol, else the Metaplex symbol. Malformed data yields null and never blocks an operation. */
export function onChainSymbol(mint: TokenMint, metaplex: ChainAccount | null | undefined): string | null {
  const extension = mint.extensions.find(e => e.type === 19)?.data;
  const fromExtension = extension ? symbolAfterName(extension, 64) : null;
  if (fromExtension) return fromExtension;
  const d = metaplex?.data;
  // Metaplex MetadataV1: key 4, update authority, mint, then name and symbol.
  if (!d || metaplex.owner !== TOKEN_METADATA_PROGRAM || d.length < 65 || d[0] !== 4 || key(d, 33) !== mint.address) return null;
  return symbolAfterName(d, 65);
}
export type TokenAccountState = { program: TokenProgram; mint: Address; authority: Address; amount: bigint;
  initialized: boolean; frozen: boolean; delegate: Address | null; delegatedAmount: bigint;
  closeAuthority: Address | null; nativeReserve: bigint | null; extensions: TokenExtension[]; withheldAmount: bigint };
/** amount is spendable; withheldAmount is a separate extension balance. */
export function decodeTokenAccount(account: ChainAccount | null | undefined): TokenAccountState {
  verifiedProgram(account);
  const exts = extensions(account, 'account'), d = account.data, v = view(d);
  requireToken(d[108] === 1 || d[108] === 2, 'token account is uninitialized or has invalid state');
  const delegate = option(d, 72) ? key(d, 76) : null, closeAuthority = option(d, 129) ? key(d, 133) : null;
  const nativeReserve = option(d, 109) ? v.getBigUint64(113, true) : null;
  const withheld = exts.find(e => e.type === 2)?.data;
  return {program:account.owner, mint:key(d, 0), authority:key(d, 32), amount:v.getBigUint64(64, true), initialized:true,
    frozen:d[108] === 2, delegate, delegatedAmount:v.getBigUint64(121, true), closeAuthority, nativeReserve, extensions:exts,
    withheldAmount:withheld ? view(withheld).getBigUint64(0, true) : 0n};
}
export async function associatedTokenAddress(owner: Address, mint: Address, program: TokenProgram) {
  requireToken(program === TOKEN_PROGRAM || program === TOKEN_2022_PROGRAM, 'invalid ATA token program');
  const encode = (a: Address) => getAddressEncoder().encode(a);
  return (await getProgramDerivedAddress({programAddress:ASSOCIATED_TOKEN_PROGRAM, seeds:[encode(owner), encode(program), encode(mint)]}))[0];
}
export function createAssociatedTokenIdempotent(payer: Address, owner: Address, mint: Address, ata: Address, program: TokenProgram): Instruction {
  requireToken(program === TOKEN_PROGRAM || program === TOKEN_2022_PROGRAM, 'invalid ATA token program');
  return {programAddress:ASSOCIATED_TOKEN_PROGRAM, data:new Uint8Array([1]), accounts:[
    {address:payer, role:AccountRole.WRITABLE_SIGNER}, {address:ata, role:AccountRole.WRITABLE},
    {address:owner, role:AccountRole.READONLY}, {address:mint, role:AccountRole.READONLY},
    {address:SYSTEM, role:AccountRole.READONLY}, {address:program, role:AccountRole.READONLY},
  ]};
}
/** Required account extensions for the decoded v1 mint capabilities. ATAs add ImmutableOwner. */
export function tokenAccountSize(mint: TokenMint, associated = true): number {
  if (mint.program === TOKEN_PROGRAM) return 165;
  const required = new Set<number>(associated ? [7] : []);
  for (const e of mint.extensions) {
    if (e.type === 1) required.add(2);
    else if (e.type === 14) required.add(15);
    else if (![18, 19].includes(e.type)) throw new VerificationError(`Token: cannot determine account size for ${e.name}`);
  }
  return required.size ? 166 + [...required].reduce((n, t) => n + 4 + fixedLengths[t]!, 0) : 165;
}
export async function tokenAccountRent(rpc: {getMinimumBalanceForRentExemption(size: number): Promise<bigint>}, mint: TokenMint, associated = true) {
  const size = tokenAccountSize(mint, associated), rent = await rpc.getMinimumBalanceForRentExemption(size);
  requireToken(rent >= 0n && rent <= U64_MAX, 'invalid account rent'); return {size, rent};
}
export type TokenTransfer = { grossAmount: bigint; transferFee: bigint; netAmount: bigint };
export function transferAmounts(grossAmount: bigint, config: TransferFeeConfig | null, epoch: bigint): TokenTransfer {
  requireToken(grossAmount >= 0n && grossAmount <= U64_MAX && epoch >= 0n && epoch <= U64_MAX, 'amount/epoch outside u64');
  const active = config && (epoch >= config.newer.epoch ? config.newer : config.older);
  if (active) requireToken(Number.isInteger(active.basisPoints) && active.basisPoints >= 0 && active.basisPoints <= 10_000
    && active.maximumFee >= 0n && active.maximumFee <= U64_MAX, 'invalid transfer fee');
  const rounded = active ? (grossAmount * BigInt(active.basisPoints) + 9_999n) / 10_000n : 0n;
  const transferFee = active && rounded > active.maximumFee ? active.maximumFee : rounded;
  return {grossAmount, transferFee, netAmount:grossAmount - transferFee};
}
