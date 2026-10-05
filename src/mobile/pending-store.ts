import { address, blockhash, signature } from '@solana/kit';
import type { PendingTransactionIdentity } from '../core/transaction';
import type { OreAction } from '../operations/ore';
import type { PrivateFiles } from './storage';
import type { MeteoraOperation } from '../operations/meteora';
import type { WithdrawalStep } from '../protocols/meteora/withdraw';

export type PendingClaim = PendingTransactionIdentity & {
  version: 1;
  action: OreAction | 'unstake' | 'kamino-repay' | 'kamino-withdraw' | 'meteora-withdraw-all';
  operationId?: string;
  step?: WithdrawalStep;
  position?: string;
  reserve?: string;
  token?: string;
  rpcUrl: string;
  createdAt: number;
};

export interface PendingStore {
  load(): Promise<PendingClaim | null>;
  save(value: PendingClaim): Promise<void>;
  clear(): Promise<void>;
  loadMeteora?(): Promise<MeteoraOperation | null>;
  saveMeteora?(operation: MeteoraOperation): Promise<void>;
  clearMeteora?(): Promise<void>;
}

export function validateMeteoraStep(value: unknown): WithdrawalStep {
  const step = value as WithdrawalStep;
  if (!step || !['remove','fees','reward','close'].includes(step.kind) || !Number.isInteger(step.lower) || !Number.isInteger(step.upper)
    || step.lower < -2147483648 || step.upper > 2147483647 || step.lower > step.upper || step.upper-step.lower >= 70
    || (step.kind === 'reward' && step.rewardIndex !== 0 && step.rewardIndex !== 1)
    || (step.kind !== 'reward' && step.rewardIndex !== undefined)
    || step.id !== (step.kind === 'close' ? 'close' : `${step.kind}:${step.lower}:${step.upper}${step.rewardIndex === undefined ? '' : ':'+step.rewardIndex}`)
    || (step.kind === 'close' && (step.lower !== 0 || step.upper !== 0))) throw new Error('Invalid Meteora step');
  return {id:step.id,kind:step.kind,lower:step.lower,upper:step.upper,...(step.rewardIndex === undefined ? {} : {rewardIndex:step.rewardIndex})};
}
function validUrl(url: unknown): url is string {
  return typeof url === 'string' && ['http:','https:'].includes(new URL(url).protocol);
}

export function createPendingStore(files: PrivateFiles): PendingStore {
  return {
    async load() {
      const contents = await files.read('pending.json');
      if (contents === null) return null;
      try {
        const value = JSON.parse(contents);
        if (value.version !== 1 || !['claim-sol', 'claim-ore', 'unstake', 'kamino-repay', 'kamino-withdraw', 'meteora-withdraw-all'].includes(value.action)
          || typeof value.rpcUrl !== 'string' || !['https:', 'http:'].includes(new URL(value.rpcUrl).protocol)
          || typeof value.lastValidBlockHeight !== 'string' || !/^\d+$/.test(value.lastValidBlockHeight)
          || !Number.isSafeInteger(value.createdAt) || value.createdAt < 0
          || (value.action.startsWith('kamino-') && (typeof value.position !== 'string' ||
            typeof value.token !== 'string' || value.token.length === 0 || typeof value.reserve !== 'string'))
          || (value.action === 'meteora-withdraw-all' && (typeof value.position !== 'string' || typeof value.operationId !== 'string' || !value.operationId))) throw new Error();
        return { version: 1, action: value.action, wallet: address(value.wallet),
          signature: signature(value.signature), blockhash: blockhash(value.blockhash),
          lastValidBlockHeight: BigInt(value.lastValidBlockHeight), rpcUrl: value.rpcUrl, createdAt: value.createdAt,
          ...(typeof value.position === 'string' ? { position: address(value.position) } : {}),
          ...(typeof value.reserve === 'string' ? { reserve: address(value.reserve) } : {}),
          ...(typeof value.token === 'string' ? { token: value.token } : {}),
          ...(value.action === 'meteora-withdraw-all' ? {operationId:value.operationId,step:validateMeteoraStep(value.step)} : {}),
        };
      } catch { throw new Error('Pending transaction record is invalid'); }
    },
    async save(value) {
      if (await files.read('pending.json') !== null) throw new Error('A transaction is already pending');
      const contents = JSON.stringify({ ...value, lastValidBlockHeight: value.lastValidBlockHeight.toString() });
      await files.write('pending.json', contents);
      if (await files.read('pending.json') !== contents) throw new Error('Pending transaction was not persisted');
    },
    async clear() { await files.remove('pending.json'); },
    async loadMeteora() {
      const contents = await files.read('meteora-operation.json');
      if (contents === null) return null;
      try {
        const value = JSON.parse(contents);
        if (value.version !== 1 || typeof value.id !== 'string' || !value.id || !validUrl(value.rpcUrl)
          || !Number.isSafeInteger(value.createdAt) || value.createdAt < 0 || !Array.isArray(value.completed) || value.completed.length > 100) throw new Error();
        const completed: MeteoraOperation['completed'] = value.completed.map((c: {step:unknown;signature:string;slot?:string}) => {
          if (c.slot !== undefined && (typeof c.slot !== 'string' || !/^\d+$/.test(c.slot))) throw new Error();
          return {step:validateMeteoraStep(c.step),signature:signature(c.signature),...(c.slot === undefined ? {} : {slot:c.slot})};
        });
        if (new Set(completed.map(c => c.step.id)).size !== completed.length) throw new Error();
        return { version:1,id:value.id,wallet:address(value.wallet),position:address(value.position),rpcUrl:value.rpcUrl,createdAt:value.createdAt,
          completed,...(value.currentStep ? {currentStep:validateMeteoraStep(value.currentStep)} : {}) };
      } catch { throw new Error('Meteora operation record is invalid'); }
    },
    async saveMeteora(operation) {
      const contents = JSON.stringify(operation);
      await files.write('meteora-operation.json',contents);
      if (await files.read('meteora-operation.json') !== contents) throw new Error('Meteora operation was not persisted');
    },
    async clearMeteora() { await files.remove('meteora-operation.json'); },
  };
}
