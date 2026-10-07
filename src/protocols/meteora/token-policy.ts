import type { Address } from '@solana/kit';
import type { ChainAccount } from '../../core/accounts';
import { decodeTokenAccount, NATIVE_TOKEN_2022_MINT, TOKEN_PROGRAM, type TokenMint } from '../../core/tokens';
import { check } from './codec';

export function validateWithdrawalMint(mint: TokenMint) {
  check(mint.address !== NATIVE_TOKEN_2022_MINT, 'Native Token-2022 mint is unsupported by the pinned DLMM interface.');
  const excluded = mint.extensions.find(e => ![1, 18, 19].includes(e.type));
  check(!excluded, `${excluded?.name} is unsupported for DLMM withdrawal${mint.transferHookProgram ? ' (active transfer hook)' : ''}.`);
}
export function withdrawalTokenState(account: ChainAccount | null | undefined, mint: TokenMint, authority: Address) {
  const state = decodeTokenAccount(account);
  check(state.program === mint.program && state.mint === mint.address && state.authority === authority, 'token program/mint/authority mismatch');
  check(!state.frozen && !state.delegate && state.delegatedAmount === 0n && !state.closeAuthority,
    'frozen, delegated or alternate close-authority token account');
  check(state.nativeReserve === null || (mint.program === TOKEN_PROGRAM && mint.address === 'So11111111111111111111111111111111111111112'),
    'unsupported native token account');
  const excluded = state.extensions.find(e => ![2, 7].includes(e.type));
  check(!excluded, `${excluded?.name} is unsupported on a DLMM withdrawal token account.`);
  check(state.extensions.some(e => e.type === 2) === !!mint.transferFee, 'TransferFeeAmount does not match the mint fee configuration');
  return state;
}
