import { address, blockhash, signature } from '@solana/kit';
import type { PendingTransactionIdentity } from '../core/transaction';
import type { OreAction } from '../operations/ore';
import type { PrivateFiles } from './storage';
import type { MeteoraOperation } from '../operations/meteora';
import { actionId, stepId, type WithdrawalAction, type WithdrawalStep } from '../protocols/meteora/withdraw';
import type { OrcaOperation } from '../operations/orca';
import { actionId as orcaActionId, stepId as orcaStepId, type WithdrawalAction as OrcaAction,
  type WithdrawalStep as OrcaStep } from '../protocols/orca/withdraw';

export type PendingClaim = PendingTransactionIdentity & {
  version: 1;
  action: OreAction | 'unstake' | 'claim-stake-rewards' | 'kamino-repay' | 'kamino-withdraw' | 'meteora-withdraw-all' | 'orca-withdraw-all'
    | 'meteora-damm-withdraw-all';
  operationId?: string;
  step?: WithdrawalStep | OrcaStep;
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
  loadOrca?(): Promise<OrcaOperation | null>;
  saveOrca?(operation: OrcaOperation): Promise<void>;
  clearOrca?(): Promise<void>;
}

function validateMeteoraAction(value: unknown): WithdrawalAction {
  const action = value as WithdrawalAction;
  if (!action || !['remove','fees','reward','close'].includes(action.kind) || !Number.isInteger(action.lower) || !Number.isInteger(action.upper)
    || action.lower < -2147483648 || action.upper > 2147483647 || action.lower > action.upper || action.upper-action.lower >= 70
    || (action.kind === 'reward' && action.rewardIndex !== 0 && action.rewardIndex !== 1)
    || (action.kind !== 'reward' && action.rewardIndex !== undefined)
    || action.id !== actionId(action.kind,action.lower,action.upper,action.rewardIndex)
    || (action.kind === 'close' && (action.lower !== 0 || action.upper !== 0))) throw new Error('Invalid Meteora step');
  return {id:action.id,kind:action.kind,lower:action.lower,upper:action.upper,...(action.rewardIndex === undefined ? {} : {rewardIndex:action.rewardIndex})};
}
/** Records saved before multi-action steps hold a single action in place of the step. */
export function validateMeteoraStep(value: unknown): WithdrawalStep {
  const step = value as { id?: unknown; actions?: unknown };
  const actions = step && Array.isArray(step.actions) ? step.actions.map(validateMeteoraAction) : [validateMeteoraAction(value)];
  if (!actions.length || actions.length > 100 || new Set(actions.map(a => a.id)).size !== actions.length
    || actions.slice(0,-1).some(a => a.kind === 'close') || step.id !== stepId(actions)) throw new Error('Invalid Meteora step');
  return {id:stepId(actions),actions};
}
function validateOrcaAction(value: unknown): OrcaAction {
  const action = value as OrcaAction;
  if (!action || !['remove','fees','reward','close'].includes(action.kind)
    || (action.kind === 'reward' ? ![0,1,2].includes(action.rewardIndex!) : action.rewardIndex !== undefined)
    || action.id !== orcaActionId(action.kind,action.rewardIndex)) throw new Error('Invalid Orca step');
  return {id:action.id,kind:action.kind,...(action.rewardIndex === undefined ? {} : {rewardIndex:action.rewardIndex})};
}
export function validateOrcaStep(value: unknown): OrcaStep {
  const step = value as { id?: unknown; actions?: unknown };
  const actions = step && Array.isArray(step.actions) ? step.actions.map(validateOrcaAction) : [];
  if (!actions.length || actions.length > 6 || new Set(actions.map(a => a.id)).size !== actions.length
    || actions.slice(0,-1).some(a => a.kind === 'close') || step.id !== orcaStepId(actions)) throw new Error('Invalid Orca step');
  return {id:orcaStepId(actions),actions};
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
        if (value.version !== 1 || !['claim-sol', 'claim-ore', 'unstake', 'claim-stake-rewards', 'kamino-repay', 'kamino-withdraw', 'meteora-withdraw-all', 'orca-withdraw-all',
          'meteora-damm-withdraw-all'].includes(value.action)
          || typeof value.rpcUrl !== 'string' || !['https:', 'http:'].includes(new URL(value.rpcUrl).protocol)
          || typeof value.lastValidBlockHeight !== 'string' || !/^\d+$/.test(value.lastValidBlockHeight)
          || !Number.isSafeInteger(value.createdAt) || value.createdAt < 0
          || (value.action.startsWith('kamino-') && (typeof value.position !== 'string' ||
            typeof value.token !== 'string' || value.token.length === 0 || typeof value.reserve !== 'string'))
          || (value.action === 'meteora-damm-withdraw-all' && typeof value.position !== 'string')
          || (['meteora-withdraw-all', 'orca-withdraw-all'].includes(value.action) && (typeof value.position !== 'string' || typeof value.operationId !== 'string' || !value.operationId))) throw new Error();
        return { version: 1, action: value.action, wallet: address(value.wallet),
          signature: signature(value.signature), blockhash: blockhash(value.blockhash),
          lastValidBlockHeight: BigInt(value.lastValidBlockHeight), rpcUrl: value.rpcUrl, createdAt: value.createdAt,
          ...(typeof value.position === 'string' ? { position: address(value.position) } : {}),
          ...(typeof value.reserve === 'string' ? { reserve: address(value.reserve) } : {}),
          ...(typeof value.token === 'string' ? { token: value.token } : {}),
          ...(value.action === 'meteora-withdraw-all' ? {operationId:value.operationId,step:validateMeteoraStep(value.step)} : {}),
          ...(value.action === 'orca-withdraw-all' ? {operationId:value.operationId,step:validateOrcaStep(value.step)} : {}),
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
    async loadOrca() {
      const contents = await files.read('orca-operation.json');
      if (contents === null) return null;
      try {
        const value = JSON.parse(contents);
        if (value.version !== 1 || value.protocol !== 'orca' || typeof value.id !== 'string' || !value.id || !validUrl(value.rpcUrl)
          || !Number.isSafeInteger(value.createdAt) || value.createdAt < 0 || !Array.isArray(value.completed) || value.completed.length > 20) throw new Error();
        const completed: OrcaOperation['completed'] = value.completed.map((c: {step:unknown;signature:string;slot?:string}) => {
          if (c.slot !== undefined && (typeof c.slot !== 'string' || !/^\d+$/.test(c.slot))) throw new Error();
          return {step:validateOrcaStep(c.step),signature:signature(c.signature),...(c.slot === undefined ? {} : {slot:c.slot})};
        });
        return { version:1,protocol:'orca',id:value.id,wallet:address(value.wallet),position:address(value.position),rpcUrl:value.rpcUrl,
          createdAt:value.createdAt,completed,...(value.currentStep ? {currentStep:validateOrcaStep(value.currentStep)} : {}) };
      } catch { throw new Error('Orca operation record is invalid'); }
    },
    async saveOrca(operation) {
      const contents = JSON.stringify(operation);
      await files.write('orca-operation.json',contents);
      if (await files.read('orca-operation.json') !== contents) throw new Error('Orca operation was not persisted');
    },
    async clearOrca() { await files.remove('orca-operation.json'); },
  };
}
