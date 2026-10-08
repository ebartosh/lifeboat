import { useEffect, useRef, useState } from 'react';
import { AppState, KeyboardAvoidingView, Platform, ScrollView, StatusBar, StyleSheet, Text, View,
  useWindowDimensions } from 'react-native';
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
import { colors, medium } from './theme';
import { AddressField, Body, Dialog, Notice, Panel, Tabs } from './Interface';
import { pingRpc, type RpcStatus } from './rpc-status';
import { OrePanel } from './OrePanel';
import { WalletConnectionError } from './wallet-connection-error';
import { WalletCheckPanel } from './WalletCheckPanel';
import { runWalletSignatureCheck, walletCheckFailure } from './wallet-check';

const rpc = getDefaultRpcUrl();
type Protocol = 'ore' | 'kamino' | 'meteora';
const shortAddress = (value: Address) => `${value.slice(0, 4)}…${value.slice(-4)}`;
const protocols: { id: Protocol; title: string }[] = [{ id: 'ore', title: 'ORE' }, { id: 'kamino', title: 'Kamino' },
  { id: 'meteora', title: 'Meteora' }];

const bundledFonts = {
  'IBMPlexMono-Regular': require('../../assets/fonts/IBMPlexMono-Regular.ttf'),
  'IBMPlexMono-Medium': require('../../assets/fonts/IBMPlexMono-Medium.ttf'),
  'IBMPlexMono-SemiBold': require('../../assets/fonts/IBMPlexMono-SemiBold.ttf'),
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
  const { width, fontScale } = useWindowDimensions();
  const [rpcStatus, setRpcStatus] = useState<RpcStatus>('checking');
  useEffect(() => {
    // One ping per app start; refresh reloads positions but does not recheck the status.
    let active = true;
    void pingRpc(rpc ? new SolanaRpcClient(rpc) : null).then(status => { if (active) setRpcStatus(status); });
    return () => { active = false; };
  }, []);
  const stakeRevision = useRef(0);
  const [kaminoPositions, setKaminoPositions] = useState<PositionStatus[] | null>(null);
  const [kaminoLoading, setKaminoLoading] = useState(false);
  const [kaminoMessage, setKaminoMessage] = useState('');
  const [kaminoReadAt, setKaminoReadAt] = useState<number | null>(null);
  const kaminoRevision = useRef(0);
  const [meteoraPositions,setMeteoraPositions] = useState<MeteoraStatus[] | null>(null);
  const [meteoraLoading,setMeteoraLoading] = useState(false);
  const [meteoraMessage,setMeteoraMessage] = useState('');
  const [meteoraReadAt,setMeteoraReadAt] = useState<number | null>(null);
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
      setKaminoPositions(positions); setKaminoReadAt(Date.now());
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
      setMeteoraPositions(positions); setMeteoraReadAt(Date.now());
    } catch {
      if (revision !== meteoraRevision.current) return;
      setMeteoraMessage('Could not read Meteora positions. Check the mainnet-beta RPC and refresh.');
    } finally { if (revision === meteoraRevision.current) setMeteoraLoading(false); }
  }

  useEffect(() => {
    loader.reset();
    stakeRevision.current += 1; kaminoRevision.current += 1; meteoraRevision.current += 1;
    setStake(null); setStakeStatus('idle'); setStakeMessage(''); setWalletDetails(false);
    setKaminoPositions(null); setKaminoLoading(false); setKaminoMessage(''); setKaminoReadAt(null);
    setMeteoraPositions(null); setMeteoraLoading(false); setMeteoraMessage(''); setMeteoraReadAt(null);
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
  const refreshDisabled = !wallet || !rpc || settingsBusy || refreshing;
  const walletTitle = wallet ? shortAddress(wallet) : 'Connect wallet';
  // Monospaced estimate of `[ RPC ● ]`, the wallet command and `[ ↻ ]` with their touch padding.
  const oneLineHeader = (18 + walletTitle.length) * 8.4 * fontScale + 40 <= width - 24;
  const walletStyle = oneLineHeader ? styles.walletCommand : styles.walletCommandEnd;
  const walletCommand = wallet
    ? <ActionButton title={walletTitle} accessibilityLabel="Wallet details" textStyle={styles.walletAddress}
      align={oneLineHeader ? 'start' : 'end'} style={walletStyle} onPress={() => setWalletDetails(true)} />
    : <ActionButton title={walletTitle} align={oneLineHeader ? 'start' : 'end'} style={walletStyle}
      disabled={settingsBusy} onPress={connectWallet} />;
  return <SafeAreaView style={styles.root}>
    <StatusBar barStyle="dark-content" backgroundColor={colors.white} />
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
        <View style={styles.masthead}>
          <Text accessibilityRole="header" style={styles.hiddenHeading}>Lifeboat</Text>
          <View style={styles.mastheadLine}>
            <RpcIndicator status={rpcStatus} />
            <View style={styles.headerCommands}>
              {oneLineHeader && walletCommand}
              <ActionButton title={refreshing ? 'Refreshing positions' : 'Refresh'} align="end"
                disabled={refreshDisabled} onPress={retrySelected}
                icon={<Text accessible={false} allowFontScaling={false}
                  style={[styles.refreshIcon, refreshDisabled && { color: colors.secondary }]}>↻</Text>} />
            </View>
          </View>
          {!oneLineHeader && <View style={styles.walletLine}>{walletCommand}</View>}
        </View>
        {!wallet && <Body>Wallet not connected</Body>}
        {!!notice && <Notice>{notice}</Notice>}
        <Tabs items={protocols} selected={protocol} onSelect={setProtocol} />
        {!rpc && <Notice error>RPC is not configured. Operations are unavailable.</Notice>}
        {!!rpc && rpcStatus === 'unreachable' &&
          <Notice error>Could not reach the RPC. Check the connection, then refresh positions.</Notice>}
        {!wallet ? <Panel title="Positions"><Body>Connect a wallet to view assets, rewards and available actions.</Body></Panel>
          : protocol === 'kamino' ? <KaminoPanel key={wallet + ':' + rpc} positions={kaminoPositions}
            loading={kaminoLoading} message={kaminoMessage} readAt={kaminoReadAt} disabled={settingsBusy || !rpc} run={startKamino} />
          : protocol === 'meteora' ? <MeteoraPanel key={wallet + ':' + rpc} positions={meteoraPositions}
            loading={meteoraLoading} message={meteoraMessage} readAt={meteoraReadAt} disabled={settingsBusy || !rpc} run={startMeteora} />
          : <OrePanel key={wallet + ':' + rpc} rewards={rewards} stake={stake} stakeStatus={stakeStatus}
            stakeMessage={stakeMessage} disabled={settingsBusy || !rpc} claim={startClaim} unstake={startUnstake} />}
        <ClaimPanel state={claim} controller={controller} resumeMeteora={operation => startMeteora(operation.position,operation)} />
      </ScrollView>
    </KeyboardAvoidingView>
    <Dialog visible={walletDetails && !!wallet} title="Wallet" onClose={() => setWalletDetails(false)}>
      {wallet && <AddressField label="Address" value={wallet} />}
      <View>
        <ActionButton title="Switch wallet" disabled={settingsBusy} style={styles.menuCommand} onPress={() => {
          setWalletDetails(false);
          connectWallet();
        }} />
        <ActionButton title="Wallet signature check" disabled={settingsBusy || !rpc} style={styles.menuCommand}
          onPress={() => { setWalletDetails(false); setWalletCheckMessage(''); setWalletCheck(true); }} />
        <ActionButton title="Disconnect wallet" style={styles.menuCommand}
          disabled={settingsBusy} variant="danger" onPress={() => {
            setWalletDetails(false);
            disconnectWallet();
          }} />
      </View>
    </Dialog>
    {wallet && <WalletCheckPanel visible={walletCheck} wallet={wallet}
      busy={settingsBusy} message={walletCheckMessage} onCheck={checkWallet} onClose={() => setWalletCheck(false)} />}
  </SafeAreaView>;
}
const rpcLabels: Record<RpcStatus, string> = {
  checking: 'RPC: checking', connected: 'RPC: connected', unreachable: 'RPC: unreachable',
};
/** Startup ping result. A status, not a command: navy text without a hotkey marker. */
function RpcIndicator({ status }: { status: RpcStatus }) {
  // The mark follows the text size, like a glyph would.
  const size = Math.round(10 * Math.min(useWindowDimensions().fontScale, 2));
  const dot = { width: size, height: size, borderRadius: size / 2 };
  const bar = { width: size * 1.2, height: Math.max(2, size / 5) };
  return <View accessible accessibilityLabel={rpcLabels[status]} accessibilityLiveRegion="polite" style={styles.rpc}>
    <Text style={styles.rpcText}>[ RPC</Text>
    {/* Each state has its own shape, so color is not the only signal. */}
    <View style={[styles.rpcMark, { width: size, height: size }]}>
      {status === 'unreachable' ? <>
        <View style={[styles.rpcCross, bar, { transform: [{ rotate: '45deg' }] }]} />
        <View style={[styles.rpcCross, bar, { transform: [{ rotate: '-45deg' }] }]} />
      </> : <View style={[dot, status === 'connected' ? styles.rpcConnected : styles.rpcChecking]} />}
    </View>
    <Text style={styles.rpcText}>]</Text>
  </View>;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white },
  screen: { flexGrow: 1, padding: 12, gap: 12, backgroundColor: colors.white },
  masthead: { minWidth: 0 },
  hiddenHeading: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0 },
  mastheadLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minWidth: 0 },
  // Fills the rest of the line rather than shrink-wrapping, so refresh can hang its touch padding past the edge.
  headerCommands: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', flexGrow: 1, flexShrink: 1,
    minWidth: 0 },
  walletLine: { alignItems: 'flex-end' },
  walletCommand: { flexShrink: 1 },
  walletCommandEnd: { flexShrink: 1, alignSelf: 'flex-end' },
  refreshIcon: { color: colors.blue, fontSize: 18, lineHeight: 20 },
  walletAddress: { color: colors.address },
  menuCommand: { alignSelf: 'stretch' },
  rpc: { flexDirection: 'row', alignItems: 'center', minHeight: 48 },
  rpcText: { fontFamily: medium, fontSize: 14, lineHeight: 20, color: colors.navy },
  rpcMark: { marginHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
  rpcConnected: { backgroundColor: colors.ok },
  rpcChecking: { borderWidth: 1.5, borderColor: colors.navy },
  rpcCross: { position: 'absolute', borderRadius: 1, backgroundColor: colors.danger },
});
