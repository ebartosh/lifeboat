import { createWithdrawalTokenPolicy } from '../../core/token-policy';
import { check } from './codec';

const policy = createWithdrawalTokenPolicy(check, 'DLMM');
export const validateWithdrawalMint = policy.validateWithdrawalMint;
export const withdrawalTokenState = policy.withdrawalTokenState;
export { sameWithdrawalMint } from '../../core/token-policy';
