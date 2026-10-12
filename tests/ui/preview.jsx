import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ScrollView, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import App from '../../src/mobile/App';
import { OrePanel } from '../../src/mobile/OrePanel';
import { KaminoPanel } from '../../src/mobile/KaminoPanel';
import { MeteoraPanel } from '../../src/mobile/MeteoraPanel';
import { OrcaPanel } from '../../src/mobile/OrcaPanel';
import { ClaimPanel } from '../../src/mobile/ClaimPanel';
import { Body, Heading } from '../../src/mobile/Interface';
import { ActionButton } from '../../src/mobile/ActionButton';
import { WalletCheckPanel } from '../../src/mobile/WalletCheckPanel';
import { UnsentTransactionExpiredError } from '../../src/core/transaction';
import { unsentExpiryHint } from '../../src/mobile/operation-error';

// React's development render log JSON-serializes changed props; the in-place "Reverse order" changes bigint amounts.
// Preview only: the app clears position lists before each refresh and never serializes bigint values.
BigInt.prototype.toJSON = function () { return this.toString(); };
const wallet = '7YttLkHDoNj9wyDur5H7Myd5FWGaBMPLys5aeQ3dJKXS';
const scenario = new URLSearchParams(location.search).get('scenario') || 'ore';
const snapshot = { miner: {}, minerAddress: wallet, claimableSol: 1n,
  ore: { amount: 18446744073709551615n, fee: 1n }, availableActions: ['claim-sol','claim-ore'],
  fees: { 'claim-sol': 5000n, 'claim-ore': 5000n }, readAt: 1700000000000 };
const stake = { wallet, stakeAddress: wallet, available: 100000000000n, claimable: 2500000000n, recipient: wallet };
window.calls = [];
function Preview() {
  const [phase, setPhase] = useState(scenario.includes('expired') ? (scenario.startsWith('meteora') || scenario.startsWith('orca') ? 'partial' : 'error') : scenario.includes('review') ? 'review' : scenario.includes('unknown') ? 'unknown' : scenario.includes('partial') ? 'partial' : 'idle');
  const [reverse, setReverse] = useState(false);
  const [request, setRequest] = useState(null);
  const [checkMessage, setCheckMessage] = useState('');
  const run = value => { window.calls.push(value); setRequest(value); setPhase('preparing'); };
  const controller = { locked: phase !== 'idle', answer: approved => { window.calls.push(approved); setPhase(approved ? 'sending' : 'cancelled'); },
    endMeteora:()=>{window.calls.push('end');setPhase('idle');}, endWithdrawal:()=>{window.calls.push('end');setPhase('idle');},
    invalidate: () => setPhase('cancelled'), check: () => { window.calls.push('check'); setPhase('checking'); } };
  const oreReview = { action: 'claim-ore', amount: snapshot.ore.amount, decimals: 11, wallet,
    recipient: wallet, feeLamports: 5000n, ore: snapshot.ore };
  const damm=scenario.startsWith('meteora-damm'), meteora=scenario.startsWith('meteora')&&!damm, orca=scenario.startsWith('orca'), withdrawal=meteora||orca;
  const tokens=[{mint:'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',symbol:'USDC',decimals:6,ata:wallet},
    {mint:'So11111111111111111111111111111111111111112',symbol:'WSOL',decimals:9,ata:wallet}].map((t,i)=>({...t,token:{transferFee:scenario.includes('transfer-fees')&&i===0?
      {older:{epoch:0n,maximumFee:1000n,basisPoints:100},newer:{epoch:5n,maximumFee:1000n,basisPoints:200},withheldAmount:0n}:null}}));
  const bins=[{id:-71,x:18446744073709551615n,y:0n,feeX:5000n,feeY:0n,rewards:[1000n,0n]}];
  const operation=orca?{version:1,protocol:'orca',id:'orca-1791189685-fixture',wallet,position:wallet,rpcUrl:'http://127.0.0.1:8899',completed:[{}]}
    :{id:'meteora-1791189685-fixture',wallet,position:wallet,rpcUrl:'http://127.0.0.1:8899',completed:[{},{}]};
  const receipts=tokens.map(t=>({...t,amount:18446744073709551615n-(t.token.transferFee?1000n:0n),grossAmount:18446744073709551615n,transferFee:t.token.transferFee?1000n:0n}));
  const review=meteora?{action:'meteora-withdraw-all',operationId:operation.id,wallet,recipient:wallet,position:wallet,
    step:{id:'remove:-71:-2,fees:-71:-2,reward:-71:-2:0',actions:[{id:'remove:-71:-2',kind:'remove',lower:-71,upper:-2},{id:'fees:-71:-2',kind:'fees',lower:-71,upper:-2},
      {id:'reward:-71:-2:0',kind:'reward',lower:-71,upper:-2,rewardIndex:0}]},completedSteps:2,remainingSteps:3,receipts:tokens.map(t=>({...t,amount:18446744073709551615n-(t.token.transferFee?1000n:0n),grossAmount:18446744073709551615n,transferFee:t.token.transferFee?1000n:0n})),
    remainingReceipts:tokens.map(t=>({...t,amount:18446744073709551615n-(t.token.transferFee?1000n:0n),grossAmount:18446744073709551615n,transferFee:t.token.transferFee?1000n:0n})),ataRent:4078560n,remainingAtaRent:6117840n,rentRefund:57406080n,feeLamports:5000n}
    :orca?{action:'orca-withdraw-all',operationId:operation.id,wallet,recipient:wallet,position:wallet,
      step:{id:'remove,fees,reward:0',actions:[{id:'remove',kind:'remove'},{id:'fees',kind:'fees'},{id:'reward:0',kind:'reward',rewardIndex:0}]},
      completedSteps:1,remainingSteps:2,receipts,remainingReceipts:receipts,ataRent:4078560n,remainingAtaRent:4078560n,rentRefund:5895120n,feeLamports:5000n,
      closeHold:'after-removal',estimatesComplete:false}:oreReview;
  const dammReview={action:'meteora-damm-withdraw-all',wallet,recipient:wallet,position:wallet,feeLamports:5000n,ataRent:2039280n,
    rentRefund:9346280n,closes:true,holds:[],holdText:null,forfeited:[],receipts,
    actions:[{kind:'refresh'},{kind:'fees'},{kind:'remove'},{kind:'reward',rewardIndex:0},{kind:'close'}]};
  if (scenario==='meteora-damm-hold-review') Object.assign(dammReview,{closes:false,holds:['vesting','permanent'],rentRefund:0n,ataRent:0n,
    holdText:'Some liquidity is still vesting; more unlocks at 2026-11-01T00:00:00.000Z. Some liquidity is permanently locked and can never be withdrawn; only its fees and rewards can be claimed.',
    forfeited:[{...tokens[0],index:1,vault:wallet,vaultFrozen:true}],actions:[{kind:'fees'},{kind:'remove'},{kind:'reward',rewardIndex:0},{kind:'reward',rewardIndex:1,skipReward:true}]});
  if (damm) { for (const key of Object.keys(review)) delete review[key]; Object.assign(review,dammReview); }
  if (scenario==='orca-single-review') Object.assign(review,{completedSteps:0,remainingSteps:1,closeHold:null,estimatesComplete:true,
    step:{id:'remove,fees,close',actions:[{id:'remove',kind:'remove'},{id:'fees',kind:'fees'},{id:'close',kind:'close'}]}});
  if (scenario.includes('wallet-review')) {
    review.walletChanges = { computeUnitLimit:240000, priorityFeeLamports:24000n, assertionCount:2 };
    review.feeLamports = 29000n;
  }
  const pending = { signature: '5'.repeat(88), wallet, action: damm?'meteora-damm-withdraw-all':meteora?'meteora-withdraw-all':orca?'orca-withdraw-all':'claim-ore',position:withdrawal||damm?wallet:undefined };
  const bytes32=()=>Array(32).fill(0);
  const dammPosition=(overrides={})=>({address:wallet,wallet,poolAddress:wallet,nftAccount:wallet,nftLocked:null,epoch:0n,timestamp:100n,currentPoint:100n,activated:true,
    state:{nft_mint:wallet,fee_a_pending:0n,fee_b_pending:0n,unlocked_liquidity:10n**22n,vested_liquidity:0n,permanent_locked_liquidity:0n,
      reward_infos:[{reward_pendings:1000n,reward_per_token_checkpoint:bytes32()},{reward_pendings:0n,reward_per_token_checkpoint:bytes32()}]},
    pool:{collect_fee_mode:0,activation_type:1,activation_point:0n,sqrt_min_price:1n<<63n,sqrt_max_price:1n<<65n,sqrt_price:1n<<64n,liquidity:10n**24n,token_a_amount:0n,token_b_amount:0n,
      reward_infos:[{initialized:1,reward_duration_end:200n,last_update_time:100n,reward_per_token_stored:bytes32()},{initialized:0,reward_duration_end:0n,last_update_time:0n,reward_per_token_stored:bytes32()}]},
    vestings:[],unlocked:10n**22n,vested:0n,permanent:0n,nextUnlock:null,liquidity:{a:18446744073709551615n,b:123456789n},fees:{a:5000n,b:0n},
    rewardAmounts:[1000n,0n],tokens,rewards:[{...tokens[0],index:0,vault:wallet,vaultFrozen:false},null],closeRefund:9346280n,...overrides});
  const dammPositions=[{address:'7YttLkHDoNj9wyDur5H7Myd5FWGaBMPLys5aeQ3dJKXT',poolAddress:wallet,position:{...dammPosition(),address:'7YttLkHDoNj9wyDur5H7Myd5FWGaBMPLys5aeQ3dJKXT'}},
    {address:'11111111111111111111111111111113',poolAddress:wallet,position:dammPosition({address:'11111111111111111111111111111113',permanent:10n**22n,vested:10n**21n,nextUnlock:1793491200n,
      state:{...dammPosition().state,permanent_locked_liquidity:10n**22n,vested_liquidity:10n**21n}})},
    {address:'11111111111111111111111111111114',poolAddress:wallet,position:dammPosition({address:'11111111111111111111111111111114',unlocked:0n,vested:10n**22n,nextUnlock:1793491200n,
      fees:{a:0n,b:0n},rewardAmounts:[0n,0n],rewards:[null,null],state:{...dammPosition().state,unlocked_liquidity:0n,vested_liquidity:10n**22n,
      reward_infos:[{reward_pendings:0n,reward_per_token_checkpoint:bytes32()},{reward_pendings:0n,reward_per_token_checkpoint:bytes32()}]},
      pool:{...dammPosition().pool,reward_infos:[{initialized:0},{initialized:0}]}})},
    {address:'11111111111111111111111111111115',poolAddress:wallet,reason:'Meteora DAMM v2: Pool is missing or has invalid owner/type'}];
  const orcaRewards=[{...tokens[0],index:0,vault:wallet,vaultAmount:10n**12n},null,null];
  const orcaPositions=[{address:wallet,kind:'position',poolAddress:wallet,position:{address:wallet,wallet,poolAddress:wallet,tokens,rewards:orcaRewards,
      state:{liquidity:10n**12n,tickLowerIndex:-443584,tickUpperIndex:443584,feeOwedA:0n,feeOwedB:0n,positionMint:wallet,rewardInfos:[{amountOwed:0n},{amountOwed:0n},{amountOwed:0n}]},
      pool:{tickCurrentIndex:-17000,rewardInfos:[{emissionsPerSecondX64:1n},{emissionsPerSecondX64:0n},{emissionsPerSecondX64:0n}]},liquidity:{a:18446744073709551615n,b:123456789n},owed:{feeA:5000n,feeB:0n,rewards:[1000n,0n,0n]},
      ticksKnown:true,epoch:0n,timestamp:100n,rentRefund:5895120n}},
    {address:'11111111111111111111111111111111',kind:'bundle',reason:'Position bundles are unsupported. Only single-position NFTs can be withdrawn here.'},
    {address:'11111111111111111111111111111112',kind:'position',reason:'Orca: This position is locked: its position token account is frozen.'}];
  const meteoraPositions=[{address:wallet,poolAddress:wallet,position:{address:wallet,wallet,tokens,rewards:[tokens[0],null],bins,epoch:0n,state:{lower_bin_id:-71,upper_bin_id:70}}},
    {address:'11111111111111111111111111111111',reason:'Legacy positions are unsupported. PositionV2 is required.'}];
  const positions = [
    { address: wallet, reason: 'Test collateral restriction', repayments: [{ token: 'SOL', reserve: wallet }, { token: 'USDC', reserve: '11111111111111111111111111111111' }] },
    { address: '11111111111111111111111111111111', reason: 'Unsupported position', repayments: [] },
  ];
  return <SafeAreaProvider><View style={{ flex: 1, backgroundColor: '#fff' }}>
    <ScrollView contentContainerStyle={{ padding: 12, gap: 12 }}>
      <Heading>Lifeboat</Heading><Body>MAINNET · Wallet 7Ytt…JKXS</Body>
      <WalletCheckPanel visible={scenario.startsWith('wallet-check')} wallet={wallet}
        busy={scenario === 'wallet-check-busy'} message={checkMessage || (scenario === 'wallet-check-busy' ? 'Opening wallet. Approve the memo signature, then return to Lifeboat. Nothing will be sent.' : '')}
        onCheck={() => { window.calls.push('memo-check'); setCheckMessage('Memo signature verified. Nothing was sent, and no network fee was paid.'); }}
        onClose={() => window.calls.push('close-check')} />
      <ClaimPanel state={{ phase, review: phase === 'review' ? review : undefined,
        message:scenario.includes('expired') ? unsentExpiryHint(new UnsentTransactionExpiredError('Fixture expiry'),withdrawal) : undefined,
        operation:withdrawal&&phase!=='idle'?operation:undefined,
        pending: ['unknown','sending','checking'].includes(phase) ? pending : undefined }} controller={controller}
        resumeWithdrawal={()=>{window.calls.push('resume');setPhase('preparing');}} />
      {orca?<OrcaPanel positions={scenario==='orca-empty'?[]:reverse?[...orcaPositions].reverse():orcaPositions}
        loading={scenario==='orca-loading'} message={scenario==='orca-error'?'Could not read Orca positions. Check the mainnet-beta RPC and refresh.':''}
        disabled={phase!=='idle'} run={run}/>:meteora||damm?<MeteoraPanel positions={scenario==='meteora-empty'||scenario==='meteora-damm-only'?[]:reverse?[...meteoraPositions].reverse():meteoraPositions}
        damm={scenario==='meteora-empty'||scenario==='meteora-damm-error'?[]:reverse?[...dammPositions].reverse():dammPositions}
        loading={scenario==='meteora-loading'} message={scenario==='meteora-error'?'Could not read Meteora DLMM positions. Check the mainnet-beta RPC and refresh.':''}
        dammMessage={scenario==='meteora-damm-error'?'Could not read Meteora DAMM v2 positions. Check the mainnet-beta RPC and refresh.':''}
        disabled={phase!=='idle'} run={run} runDamm={position=>run('damm:'+position)}/>:scenario === 'kamino' ? <KaminoPanel positions={reverse ? [...positions].reverse() : positions}
        loading={false} message="" disabled={phase !== 'idle'} run={run} />
        : <OrePanel rewards={scenario === 'loading' ? { status: 'loading' } : scenario === 'error' ? { status: 'error', message: 'RPC unavailable' }
          : { status: 'ready', snapshot: scenario === 'empty' ? { ...snapshot, miner: null } : snapshot }}
          stake={['loading','empty','error'].includes(scenario) ? null : stake}
          stakeStatus={scenario === 'loading' ? 'loading' : scenario === 'error' ? 'error' : 'ready'}
          stakeMessage="RPC unavailable" disabled={phase !== 'idle'} claim={run} unstake={run} claimStakeRewards={run} />}
      <Body>Font check: Aa Zz 0/O 1/l/I ≈ … ORE/SOL</Body>
    </ScrollView>
    <View style={{ padding: 8, borderTopWidth: 1, borderColor: '#163B73' }}>
      <ActionButton title="Reverse order" onPress={() => setReverse(value => !value)} />
    </View>
  </View></SafeAreaProvider>;
}
createRoot(document.getElementById('root')).render(scenario === 'no-wallet' ? <App /> : <Preview />);
