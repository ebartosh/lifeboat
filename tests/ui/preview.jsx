import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ScrollView, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import App from '../../src/mobile/App';
import { OrePanel } from '../../src/mobile/OrePanel';
import { KaminoPanel } from '../../src/mobile/KaminoPanel';
import { MeteoraPanel } from '../../src/mobile/MeteoraPanel';
import { ClaimPanel } from '../../src/mobile/ClaimPanel';
import { Body, Heading } from '../../src/mobile/Interface';
import { ActionButton } from '../../src/mobile/ActionButton';
import { WalletCheckPanel } from '../../src/mobile/WalletCheckPanel';
import { UnsentTransactionExpiredError } from '../../src/core/transaction';
import { unsentExpiryHint } from '../../src/mobile/operation-error';

const wallet = '7YttLkHDoNj9wyDur5H7Myd5FWGaBMPLys5aeQ3dJKXS';
const scenario = new URLSearchParams(location.search).get('scenario') || 'ore';
const snapshot = { miner: {}, minerAddress: wallet, claimableSol: 1n,
  ore: { amount: 18446744073709551615n, fee: 1n }, availableActions: ['claim-sol','claim-ore'],
  fees: { 'claim-sol': 5000n, 'claim-ore': 5000n }, readAt: 1700000000000 };
const stake = { wallet, stakeAddress: wallet, available: 100000000000n, recipient: wallet };
window.calls = [];
function Preview() {
  const [phase, setPhase] = useState(scenario.includes('expired') ? (scenario.startsWith('meteora') ? 'partial' : 'error') : scenario.includes('review') ? 'review' : scenario.includes('unknown') ? 'unknown' : scenario.includes('partial') ? 'partial' : 'idle');
  const [reverse, setReverse] = useState(false);
  const [request, setRequest] = useState(null);
  const [checkMessage, setCheckMessage] = useState('');
  const run = value => { window.calls.push(value); setRequest(value); setPhase('preparing'); };
  const controller = { answer: approved => { window.calls.push(approved); setPhase(approved ? 'sending' : 'cancelled'); },
    endMeteora:()=>{window.calls.push('end');setPhase('idle');},
    invalidate: () => setPhase('cancelled'), check: () => { window.calls.push('check'); setPhase('checking'); } };
  const oreReview = { action: 'claim-ore', amount: snapshot.ore.amount, decimals: 11, wallet,
    recipient: wallet, feeLamports: 5000n, ore: snapshot.ore };
  const meteora=scenario.startsWith('meteora');
  const tokens=[{mint:'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',symbol:'USDC',decimals:6,ata:wallet},
    {mint:'So11111111111111111111111111111111111111112',symbol:'WSOL',decimals:9,ata:wallet}].map((t,i)=>({...t,token:{transferFee:scenario.includes('transfer-fees')&&i===0?
      {older:{epoch:0n,maximumFee:1000n,basisPoints:100},newer:{epoch:5n,maximumFee:1000n,basisPoints:200},withheldAmount:0n}:null}}));
  const bins=[{id:-71,x:18446744073709551615n,y:0n,feeX:5000n,feeY:0n,rewards:[1000n,0n]}];
  const operation={id:'meteora-1791189685-fixture',wallet,position:wallet,rpcUrl:'http://127.0.0.1:8899',completed:[{},{}]};
  const review=meteora?{action:'meteora-withdraw-all',operationId:operation.id,wallet,recipient:wallet,position:wallet,
    step:{kind:'remove',lower:-71,upper:-2},completedSteps:2,remainingSteps:7,receipts:tokens.map(t=>({...t,amount:18446744073709551615n-(t.token.transferFee?1000n:0n),grossAmount:18446744073709551615n,transferFee:t.token.transferFee?1000n:0n})),
    remainingReceipts:tokens.map(t=>({...t,amount:18446744073709551615n-(t.token.transferFee?1000n:0n),grossAmount:18446744073709551615n,transferFee:t.token.transferFee?1000n:0n})),ataRent:4078560n,remainingAtaRent:6117840n,rentRefund:57406080n,feeLamports:5000n}:oreReview;
  if (scenario.includes('wallet-review')) {
    review.walletChanges = { computeUnitLimit:240000, priorityFeeLamports:24000n, assertionCount:2 };
    review.feeLamports = 29000n;
  }
  const pending = { signature: '5'.repeat(88), wallet, action: meteora?'meteora-withdraw-all':'claim-ore',position:meteora?wallet:undefined };
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
      {meteora?<MeteoraPanel positions={scenario==='meteora-empty'?[]:reverse?[...meteoraPositions].reverse():meteoraPositions}
        loading={scenario==='meteora-loading'} message={scenario==='meteora-error'?'Could not read Meteora positions. Check the RPC and refresh.':''}
        disabled={phase!=='idle'} run={run}/>:scenario === 'kamino' ? <KaminoPanel positions={reverse ? [...positions].reverse() : positions}
        loading={false} message="" disabled={phase !== 'idle'} run={run} />
        : <OrePanel rewards={scenario === 'loading' ? { status: 'loading' } : scenario === 'error' ? { status: 'error', message: 'RPC unavailable' }
          : { status: 'ready', snapshot: scenario === 'empty' ? { ...snapshot, miner: null } : snapshot }}
          stake={['loading','empty','error'].includes(scenario) ? null : stake}
          stakeStatus={scenario === 'loading' ? 'loading' : scenario === 'error' ? 'error' : 'ready'}
          stakeMessage="RPC unavailable" disabled={phase !== 'idle'} claim={run} unstake={run} />}
      <ClaimPanel state={{ phase, review: phase === 'review' ? review : undefined,
        message:scenario.includes('expired') ? unsentExpiryHint(new UnsentTransactionExpiredError('Fixture expiry'),meteora) : undefined,
        operation:meteora&&phase!=='idle'?operation:undefined,
        pending: ['unknown','sending','checking'].includes(phase) ? pending : undefined }} controller={controller}
        resumeMeteora={()=>{window.calls.push('resume');setPhase('preparing');}} />
      <Body>Font check: Aa Zz 0/O 1/l/I ≈ … ORE/SOL</Body>
    </ScrollView>
    <View style={{ padding: 8, borderTopWidth: 1, borderColor: '#163B73' }}>
      <ActionButton title="Reverse order" onPress={() => setReverse(value => !value)} />
    </View>
  </View></SafeAreaProvider>;
}
createRoot(document.getElementById('root')).render(scenario === 'no-wallet' ? <App /> : <Preview />);
