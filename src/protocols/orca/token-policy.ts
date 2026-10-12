import { createWithdrawalTokenPolicy } from '../../core/token-policy';
import { check } from './codec';

// The same receipt-token policy as Meteora DLMM: see docs/token-infrastructure.md.
const policy = createWithdrawalTokenPolicy(check, 'Whirlpool');
export const validateWithdrawalMint = policy.validateWithdrawalMint;
export const withdrawalTokenState = policy.withdrawalTokenState;
export { sameWithdrawalMint } from '../../core/token-policy';
