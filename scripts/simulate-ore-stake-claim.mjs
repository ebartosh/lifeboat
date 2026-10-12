// Unsigned, read-only validation. There is no signing material and send is blocked.
import { mkdir, writeFile } from 'node:fs/promises';
import { address } from '@solana/kit';
import { SolanaRpcClient } from '../src/core/rpc.ts';
import { claimStakeRewards } from '../src/operations/stake-rewards.ts';
import { readStakePosition } from '../src/protocols/ore-stake.ts';
// Public staker from tests/fixtures/rpc/ore-stake.json, not a project-owned wallet. Pass another as an argument.
const wallet = address(process.argv[2] ?? 'EfixMV4qZLx7DRdQf8xADMLe5bsKzRZfumf2SfAkZusH');
const rpc = new SolanaRpcClient(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com');
rpc.sendTransaction = async () => { throw new Error('Submission is disabled for read-only integration verification'); };
const position = await readStakePosition(rpc, wallet);
if (!position) throw new Error(`No direct ore-stake position for ${wallet}`);
let report;
const result = await claimStakeRewards({ rpc, wallet,
  signWithWallet: async () => { throw new Error('Signing disabled'); },
  confirm: async review => {
    report = { unsigned: true, submitted: false, wallet, stake: position.stakeAddress,
      balance: position.balance.toString(), estimated: position.claimable.toString(), simulated: review.amount.toString(),
      unitsConsumed: review.simulation.unitsConsumed?.toString(), feeLamports: review.feeLamports?.toString(),
      snapshotSlot: review.simulation.snapshot?.slot.toString() };
    return false;
  } });
if (result.status !== 'cancelled' || !report) throw new Error(`Unexpected result: ${result.status}`);
if (BigInt(report.simulated) < BigInt(report.estimated)) throw new Error('Simulated payout is below the offline estimate');
await mkdir('.cache', { recursive: true });
await writeFile('.cache/ore-stake-claim-simulation.json', JSON.stringify(report, null, 2));
console.log(`Unsigned mainnet Claim simulation passed: estimated ${report.estimated}, simulated ${report.simulated} ` +
  `base units at slot ${report.snapshotSlot}; no signature or submission.`);
