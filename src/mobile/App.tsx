import { useEffect, useRef, useState } from 'react';
import { AppState, KeyboardAvoidingView, Platform, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import type { Address } from '@solana/kit';
import { createOreClient } from '../operations/client';
import { externalWallet, pendingStore } from './native-storage';
import { SolanaRpcClient } from '../core/rpc';
import { ClaimController, type ClaimState } from './claim-controller';
import { ClaimPanel } from './ClaimPanel';
import type { OreAction } from '../operations/ore';
import { RewardsLoader, type RewardsState } from './rewards-loader';
import { readStakePosition, parseOreAmount, type StakePosition } from '../protocols/ore-stake';
import { unstakeOre } from '../operations/unstake';
import { executeKamino, readKaminoPositions, type KaminoRequest } from '../operations/kamino';
import type { PositionStatus } from '../protocols/kamino/adapter';
import { KaminoPanel } from './KaminoPanel';
import { MeteoraPanel } from './MeteoraPanel';
import { executeMeteora, readMeteoraPositions, type MeteoraOperation } from '../operations/meteora';
import { MeteoraAdapter, type MeteoraStatus } from '../protocols/meteora/adapter';
import { getDefaultRpcUrl } from './rpc-config';
import { ActionButton } from './ActionButton';
import { colors, ui } from './theme';
import { AddressField, Body, Dialog, Heading, Notice, Panel } from './Interface';
import { OrePanel } from './OrePanel';
import { WalletConnectionError } from './wallet-connection-error';
import { WalletCheckPanel } from './WalletCheckPanel';
import { runWalletSignatureCheck, walletCheckFailure } from './wallet-check';

const rpc = getDefaultRpcUrl();
type Protocol = 'ore' | 'kamino' | 'meteora';
const shortAddress = (value: Address) => `${value.slice(0, 4)}…${value.slice(-4)}`;

const bundledFonts = {
  'IBMPlexMono-Regular': require('../../assets/fonts/IBMPlexMono-Regular.ttf'),
  'IBMPlexMono-Medium': require('../../assets/fonts/IBMPlexMono-Medium.ttf'),
  'IBMPlexSerif-Regular': require('../../assets/fonts/IBMPlexSerif-Regular.ttf'),
  'IBMPlexSerif-Medium': require('../../assets/fonts/IBMPlexSerif-Medium.ttf'),
};
export default function App() {
  const [attempt, setAttempt] = useState(0);
  return <SafeAreaProvider><FontGate key={attempt} retry={() => setAttempt(value => value + 1)} /></SafeAreaProvider>;
}
function FontGate({ retry }: { retry: () => void }) {
  const [loaded, error] = useFonts(bundledFonts);
  if (!loaded) return <SafeAreaView style={styles.root}><View style={styles.screen}>
    <Text accessibilityLiveRegion="polite" style={{ color: colors.navy, fontSize: 16 }}>
      {error ? 'Could not load bundled fonts. Please try again.' : 'Loading interface…'}
    </Text>{error && <ActionButton title="Retry" onPress={retry} />}
  </View></SafeAreaView>;
  return <WalletApp />;
}
function WalletApp() {
  const [wallet, setWallet] = useState<Address | null>(null);
  const [protocol, setProtocol] = useState<Protocol>('ore');
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [busy, setBusy] = useState(true);
  const locked = useRef(true);
  const [notice, setNotice] = useState('Loading settings…');
  const [rewards, setRewards] = useState<RewardsState>({ status: 'idle' });
  const [loader] = useState(() => new RewardsLoader(setRewards,
    (url, address) => createOreClient(url).readSnapshot(address)));
  const [claim, setClaim] = useState<ClaimState>({ phase: 'idle' });
  const [stake, setStake] = useState<StakePosition | null>(null);
  const [stakeStatus, setStakeStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [stakeMessage, setStakeMessage] = useState('');
  const [walletDetails, setWalletDetails] = useState(false);
  const [walletCheck, setWalletCheck] = useState(false);
  const [walletCheckMessage, setWalletCheckMessage] = useState('');
  useEffect(() => { setWalletCheck(false); setWalletCheckMessage(''); }, [wallet]);
  const stakeRevision = useRef(0);
  const [kaminoPositions, setKaminoPositions] = useState<PositionStatus[] | null>(null);
  const [kaminoLoading, setKaminoLoading] = useState(false);
  const [kaminoMessage, setKaminoMessage] = useState('');
  const kaminoRevision = useRef(0);
  const [meteoraPositions,setMeteoraPositions] = useState<MeteoraStatus[] | null>(null);
  const [meteoraLoading,setMeteoraLoading] = useState(false);
  const [meteoraMessage,setMeteoraMessage] = useState('');
  const meteoraRevision = useRef(0);
  const [controller] = useState(() => new ClaimController({ store: pendingStore,
    execute: (url, action, input) => {
      const client = createOreClient(url);
      return action === 'claim-sol' ? client.claimSol(input) : client.claimOre(input);
    },
    unstake: (url, amount, input) => unstakeOre({ rpc: new SolanaRpcClient(url), amount, ...input }),
    kamino: (url, request, input) => executeKamino(url, request, input),
    meteora:executeMeteora,
    meteoraClosed:async (operation,minSlot) => await new MeteoraAdapter().readPosition(new SolanaRpcClient(operation.rpcUrl),operation.wallet,operation.position,minSlot) === null,
    status: pending => new SolanaRpcClient(pending.rpcUrl).getSignatureStatus(pending.signature),
    height: pending => new SolanaRpcClient(pending.rpcUrl).getBlockHeight(),
  }, state => { setClaim(state); if (state.phase !== 'idle') loader.reset(); }));

  useEffect(() => {
    let active = true;
    controller.setForeground(AppState.currentState === 'active');
    void (async () => {
      const [externalResult] = await Promise.allSettled([
        externalWallet.read(), controller.restore(),
      ]);
      if (!active) return;
      if (externalResult.status === 'fulfilled' && externalResult.value) {
        setWallet(externalResult.value.address);
      }
      setNotice(externalResult.status === 'rejected' ? 'Could not read saved wallet data.' : '');
      locked.current = false; setBusy(false);
    })();
    const subscription = AppState.addEventListener('change', state => {
      controller.setForeground(state === 'active');
      setForeground(state === 'active');
      if (state !== 'active') {
        loader.reset(); stakeRevision.current += 1; kaminoRevision.current += 1; meteoraRevision.current += 1;
      }
    });
    return () => { active = false; controller.setForeground(false); loader.dispose(); subscription.remove(); };
  }, [loader, controller]);

  async function refreshStake(url = rpc, address = wallet) {
    if (!address || !url) return;
    const revision = ++stakeRevision.current;
    setStake(null); setStakeStatus('loading');
    try {
      const position = await readStakePosition(new SolanaRpcClient(url), address);
      if (revision !== stakeRevision.current) return;
      setStake(position); setStakeStatus('ready'); setStakeMessage('');
    } catch {
      if (revision !== stakeRevision.current) return;
      setStake(null); setStakeStatus('error');
      setStakeMessage('Could not read direct staking. Check the network and accounts.');
    }
  }

  async function refreshKamino(url = rpc, address = wallet) {
    if (!address || !url) return;
    const revision = ++kaminoRevision.current;
    setKaminoPositions(null); setKaminoLoading(true); setKaminoMessage('');
    try {
      const positions = await readKaminoPositions(url, address);
      if (revision !== kaminoRevision.current) return;
      setKaminoPositions(positions);
    } catch (error) {
      if (revision !== kaminoRevision.current) return;
      setKaminoPositions(null);
      setKaminoMessage(error instanceof Error ? error.message : 'Could not read Kamino positions');
    } finally { if (revision === kaminoRevision.current) setKaminoLoading(false); }
  }

  async function refreshMeteora(url = rpc, address = wallet) {
    if (!address || !url) return;
    const revision = ++meteoraRevision.current;
    setMeteoraPositions(null); setMeteoraLoading(true); setMeteoraMessage('');
    try {
      const positions = await readMeteoraPositions(url,address);
      if (revision !== meteoraRevision.current) return;
      setMeteoraPositions(positions);
    } catch {
      if (revision !== meteoraRevision.current) return;
      setMeteoraMessage('Could not read Meteora positions. Check the mainnet-beta RPC and refresh.');
    } finally { if (revision === meteoraRevision.current) setMeteoraLoading(false); }
  }

  useEffect(() => {
    loader.reset();
    stakeRevision.current += 1; kaminoRevision.current += 1; meteoraRevision.current += 1;
    setStake(null); setStakeStatus('idle'); setStakeMessage(''); setWalletDetails(false);
    setKaminoPositions(null); setKaminoLoading(false); setKaminoMessage('');
    setMeteoraPositions(null); setMeteoraLoading(false); setMeteoraMessage('');
    if (!busy && foreground && wallet && rpc) {
      if (protocol === 'ore') {
        void refreshStake(rpc, wallet);
        void loader.refresh(rpc, wallet);
      } else if (protocol === 'kamino') void refreshKamino(rpc, wallet);
      else void refreshMeteora(rpc,wallet);
    }
    return () => { loader.dispose(); stakeRevision.current += 1; kaminoRevision.current += 1; meteoraRevision.current += 1; };
  }, [wallet, protocol, busy, foreground]);

  useEffect(() => {
    if (claim.phase !== 'confirmed' || !wallet || !rpc || !foreground) return;
    if (protocol === 'ore') {
      void refreshStake(rpc, wallet);
      void loader.refresh(rpc, wallet);
    } else if (protocol === 'kamino') void refreshKamino(rpc, wallet);
    else void refreshMeteora(rpc,wallet);
  }, [claim.phase]);

  async function run(action: () => Promise<void>, failure: string) {
    if (locked.current || controller.locked) return;
    controller.invalidate();
    locked.current = true; setBusy(true);
    try { await action(); } catch (error) {
      setNotice(error instanceof WalletConnectionError ? error.message : failure);
    }
    finally { locked.current = false; setBusy(false); }
  }

  function connectWallet() {
    void run(async () => {
      loader.reset();
      setNotice('Opening wallet. Approve the connection in your wallet, then return to Lifeboat.');
      const previousWallet = wallet;
      try {
        const connection = await externalWallet.connect();
        setWallet(connection.address);
        setNotice('External wallet connected.');
      } catch (error) {
        setWallet(previousWallet);
        throw error;
      }
    }, 'Could not connect the wallet. Check your installed MWA wallet and try again.');
  }

  function disconnectWallet() {
    void run(async () => {
      loader.reset(); await externalWallet.disconnect();
      setWallet(null); setNotice('External wallet connection removed');
    }, 'Could not remove the wallet connection. Please try again.');
  }

  function checkWallet() {
    if (!wallet || !rpc) return;
    void run(async () => {
      setWalletCheckMessage('Reading a fresh blockhash…');
      try {
        await runWalletSignatureCheck(wallet, new SolanaRpcClient(rpc),
          transaction => externalWallet.sign(wallet, transaction),
          () => setWalletCheckMessage('Opening wallet. Approve the memo signature, then return to Lifeboat. Nothing will be sent.'));
        setWalletCheckMessage('Memo signature verified. Nothing was sent, and no network fee was paid.');
      } catch (error) { setWalletCheckMessage(walletCheckFailure(error)); }
    }, 'Could not check the wallet signature. Nothing was sent.');
  }

  function retrySelected() {
    if (!wallet || !rpc) return;
    if (protocol === 'ore') {
      void refreshStake(rpc, wallet);
      void loader.refresh(rpc, wallet);
    } else if (protocol === 'kamino') void refreshKamino(rpc, wallet);
    else void refreshMeteora(rpc,wallet);
  }

  const settingsBusy = busy || controller.locked;
  function startClaim(action: OreAction) {
    if (locked.current || controller.locked || !wallet || !rpc) return;
    void controller.start(rpc, wallet, action,
      { signWithWallet: transaction => externalWallet.sign(wallet, transaction) });
  }
  function startUnstake(unstakeAmount: string) {
    if (locked.current || controller.locked || !wallet || !rpc || !stake) return;
    try {
      const amount = parseOreAmount(unstakeAmount);
      if (amount > stake.available) throw new Error('Insufficient ORE in direct staking');
      setStakeMessage('');
      void controller.start(rpc, wallet, 'unstake',
        { signWithWallet: transaction => externalWallet.sign(wallet, transaction) }, unstakeAmount);
    } catch (error) { setStakeMessage(error instanceof Error ? error.message : 'Invalid amount'); }
  }
  function startKamino(request: KaminoRequest) {
    if (locked.current || controller.locked || !wallet || !rpc) return;
    setKaminoMessage('');
    void controller.start(rpc, wallet, request.action === 'repay' ? 'kamino-repay' : 'kamino-withdraw',
      { signWithWallet: transaction => externalWallet.sign(wallet, transaction) }, request.amount, request);
  }
  function startMeteora(position: Address, operation?: MeteoraOperation) {
    if (locked.current || !wallet || !rpc || (controller.locked && !operation)) return;
    setMeteoraMessage('');
    void controller.startMeteora(operation?.rpcUrl ?? rpc,wallet,position,
      {signWithWallet:transaction => externalWallet.sign(wallet,transaction)});
  }
  const refreshing = protocol === 'ore' ? stakeStatus === 'loading' || rewards.status === 'loading'
    : protocol === 'kamino' ? kaminoLoading : meteoraLoading;
  return <SafeAreaView style={styles.root}>
    <StatusBar barStyle="dark-content" backgroundColor={colors.white} />
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
        <View style={styles.masthead}>
          <Heading>Lifeboat</Heading>
          <View style={styles.headerCommands}>
            {wallet ? <ActionButton title="Wallet details" style={styles.walletCommand} onPress={() => setWalletDetails(true)} />
              : <ActionButton title="Connect wallet" style={styles.walletCommand} disabled={settingsBusy} onPress={connectWallet} />}
            <ActionButton title={refreshing ? 'Refreshing positions' : 'Refresh'} style={styles.refreshCommand}
              disabled={!wallet || !rpc || settingsBusy || refreshing} onPress={retrySelected}
              icon={<Text accessible={false} allowFontScaling={false} style={styles.refreshIcon}>↻</Text>} />
          </View>
        </View>
        <Body>{wallet ? 'Wallet ' + shortAddress(wallet) : 'Wallet not connected'}</Body>
        {!!notice && <Notice>{notice}</Notice>}
        <View style={ui.commands}>
          {(['ore', 'kamino', 'meteora'] as const).map(item => <ActionButton key={item} selected={protocol === item}
            title={item === 'ore' ? 'ORE' : item === 'kamino' ? 'Kamino' : 'Meteora'} onPress={() => setProtocol(item)} />)}
        </View>
        <Body style={styles.path}>Lifeboat / {protocol === 'ore' ? 'ORE' : protocol === 'kamino' ? 'Kamino' : 'Meteora'}</Body>
        {!rpc && <Notice error>RPC is not configured. Operations are unavailable.</Notice>}
        {!wallet ? <Panel title="Positions"><Body>Connect a wallet to view assets, rewards and available actions.</Body></Panel>
          : protocol === 'kamino' ? <KaminoPanel key={wallet + ':' + rpc} positions={kaminoPositions}
            loading={kaminoLoading} message={kaminoMessage} disabled={settingsBusy || !rpc} run={startKamino} />
          : protocol === 'meteora' ? <MeteoraPanel key={wallet + ':' + rpc} positions={meteoraPositions}
            loading={meteoraLoading} message={meteoraMessage} disabled={settingsBusy || !rpc} run={startMeteora} />
          : <OrePanel key={wallet + ':' + rpc} rewards={rewards} stake={stake} stakeStatus={stakeStatus}
            stakeMessage={stakeMessage} disabled={settingsBusy || !rpc} claim={startClaim} unstake={startUnstake} />}
        <ClaimPanel state={claim} controller={controller} resumeMeteora={operation => startMeteora(operation.position,operation)} />
      </ScrollView>
    </KeyboardAvoidingView>
    <Dialog visible={walletDetails && !!wallet} title="Wallet" onClose={() => setWalletDetails(false)}>
      <Body>External wallet</Body>
      {wallet && <AddressField label="Wallet" value={wallet} />}
      <ActionButton title="Switch wallet" disabled={settingsBusy} onPress={() => {
        setWalletDetails(false);
        connectWallet();
      }} />
      <ActionButton title="Wallet signature check" disabled={settingsBusy || !rpc}
        onPress={() => { setWalletDetails(false); setWalletCheckMessage(''); setWalletCheck(true); }} />
      <ActionButton title="Disconnect wallet"
        disabled={settingsBusy} variant="danger" onPress={() => {
          setWalletDetails(false);
          disconnectWallet();
        }} />
    </Dialog>
    {wallet && <WalletCheckPanel visible={walletCheck} wallet={wallet}
      busy={settingsBusy} message={walletCheckMessage} onCheck={checkWallet} onClose={() => setWalletCheck(false)} />}
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white },
  screen: { flexGrow: 1, padding: 12, gap: 12, backgroundColor: colors.white },
  masthead: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  headerCommands: { flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 'auto', maxWidth: '100%' },
  walletCommand: { flexShrink: 1 },
  refreshCommand: { width: 48, paddingHorizontal: 0, alignItems: 'center' },
  refreshIcon: { color: colors.blue, fontSize: 28, lineHeight: 28 },
  path: { color: colors.blue, paddingVertical: 8, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.blue },
});
