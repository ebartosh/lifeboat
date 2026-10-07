import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transaction } from '@solana/kit';

const mocks = vi.hoisted(() => ({
  transact: vi.fn(),
  authorize: vi.fn(),
  signTransactions: vi.fn(),
  getCapabilities: vi.fn(),
  appState: { currentState: 'active', addEventListener: vi.fn() },
}));
vi.mock('react-native', () => ({ AppState: mocks.appState }));
vi.mock('@solana-mobile/mobile-wallet-adapter-protocol-kit', () => ({ transact: mocks.transact }));

import { mwaAdapter } from '../src/mobile/mwa-adapter';
import { walletConnectionFailure } from '../src/mobile/wallet-connection-error';

const result = {
  accounts: [{ address: Buffer.from(new Uint8Array(32)).toString('base64') }],
  auth_token: 'new-token',
  wallet_uri_base: 'https://wallet.example',
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('EXPO_PUBLIC_WALLET_IDENTITY_URI', '');
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  mocks.appState.currentState = 'active';
  mocks.authorize.mockResolvedValue(result);
  mocks.getCapabilities.mockResolvedValue({ features: ['solana:signTransactions'], supported_transaction_versions: ['legacy'],
    supports_sign_and_send_transactions: true, max_transactions_per_request: 1 });
  mocks.transact.mockImplementation(async callback => callback({
    authorize: mocks.authorize, signTransactions: mocks.signTransactions, getCapabilities: mocks.getCapabilities,
  }));
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('MWA connection requests', () => {
  it('logs only known capability flags, never arbitrary feature or version strings', async () => {
    const connection = await mwaAdapter.connect();
    mocks.getCapabilities.mockResolvedValue({ features: ['solana:signTransactions', 'secret-token'],
      supported_transaction_versions: ['legacy', 0, 'secret-address'],
      max_transactions_per_request: 'secret-limit', supports_sign_and_send_transactions: true });
    mocks.signTransactions.mockResolvedValue([{} as Transaction]);
    await mwaAdapter.sign(connection, {} as Transaction);
    const trace = vi.mocked(console.info).mock.calls.flat().join('\n');
    expect(trace).toMatch(/event=capabilities .*signTransactions=yes signAndSend=yes legacy=yes v0=yes maxTransactions=unknown/);
    expect(trace).not.toContain('secret-');
  });
  it('continues the normal signing path when capability discovery is unavailable', async () => {
    const connection = await mwaAdapter.connect();
    mocks.getCapabilities.mockRejectedValue(Object.assign(new Error('secret-payload'), { code: -32601 }));
    mocks.signTransactions.mockResolvedValue([{} as Transaction]);
    await mwaAdapter.sign(connection, {} as Transaction);
    expect(mocks.signTransactions).toHaveBeenCalledOnce();
    const trace = vi.mocked(console.info).mock.calls.flat().join('\n');
    expect(trace).toMatch(/event=capabilities-failure .*reason=method-not-found protocolCode=-32601/);
    expect(trace).not.toContain('secret-payload');
  });
  it('uses the same configured project identity for connection and signing', async () => {
    vi.stubEnv('EXPO_PUBLIC_WALLET_IDENTITY_URI', 'https://lifeboat.example/app');
    const connection = await mwaAdapter.connect();
    mocks.signTransactions.mockResolvedValue([{} as Transaction]);
    await mwaAdapter.sign(connection, {} as Transaction);
    expect(mocks.authorize.mock.calls.map(call => call[0].identity)).toEqual([
      { name: 'Lifeboat', uri: 'https://lifeboat.example/app' },
      { name: 'Lifeboat', uri: 'https://lifeboat.example/app' },
    ]);
  });
  it('does not open a wallet when project identity configuration is invalid', async () => {
    vi.stubEnv('EXPO_PUBLIC_WALLET_IDENTITY_URI', 'http://localhost');
    await expect(mwaAdapter.connect()).rejects.toThrow(/public HTTPS/);
    expect(mocks.transact).not.toHaveBeenCalled();
  });
  it('requests fresh authorization without a token or a pinned wallet', async () => {
    const connection = await mwaAdapter.connect();
    expect(mocks.transact.mock.calls[0]).toHaveLength(1);
    expect(mocks.authorize).toHaveBeenCalledExactlyOnceWith({
      chain: 'solana:mainnet', identity: { name: 'Lifeboat' },
    });
    expect(connection).toEqual({ version: 1, address: '11111111111111111111111111111111',
      authToken: 'new-token', walletUriBase: result.wallet_uri_base });
    const trace = vi.mocked(console.info).mock.calls.flat().join('\n');
    expect(trace).toMatch(/event=session-ready/);
    expect(trace).toMatch(/event=authorize-start/);
    expect(trace).toMatch(/event=authorize-result/);
    expect(trace).toMatch(/event=success/);
    expect(trace).not.toContain(result.auth_token);
    expect(trace).not.toContain(result.accounts[0].address);
    expect(trace).not.toContain(result.wallet_uri_base);
  });

  it('distinguishes an opened wallet with no session from authorization failure', async () => {
    mocks.transact.mockRejectedValueOnce(new Error('Timed out waiting for local association to be ready'));
    await expect(mwaAdapter.connect()).rejects.toThrow(/did not establish an MWA session/);
    expect(mocks.authorize).not.toHaveBeenCalled();
    expect(vi.mocked(console.info).mock.calls.flat().join('\n')).toMatch(/phase=session reason=timeout/);
    mocks.authorize.mockRejectedValueOnce(new Error('Timed out waiting for response'));
    await expect(mwaAdapter.connect()).rejects.toThrow(/did not authorize/);
    expect(vi.mocked(console.info).mock.calls.flat().join('\n')).toMatch(/phase=authorization reason=timeout/);
  });

  it('waits for the app to return before completing the connection', async () => {
    mocks.appState.currentState = 'background';
    const remove = vi.fn();
    mocks.appState.addEventListener.mockReturnValue({ remove });
    const connect = mwaAdapter.connect();
    await vi.waitFor(() => expect(mocks.appState.addEventListener).toHaveBeenCalled());
    const listener = mocks.appState.addEventListener.mock.calls[0][1];
    listener('active');
    await expect(connect).resolves.toMatchObject({ authToken: 'new-token' });
    expect(remove).toHaveBeenCalledOnce();
  });

  it('cleans up the foreground listener when the wallet does not return', async () => {
    vi.useFakeTimers();
    mocks.appState.currentState = 'background';
    const remove = vi.fn();
    mocks.appState.addEventListener.mockReturnValue({ remove });
    const failure = expect(mwaAdapter.connect()).rejects.toThrow(/without a usable account/);
    await vi.advanceTimersByTimeAsync(30_000);
    await failure;
    expect(remove).toHaveBeenCalledOnce();
  });

  it('keeps token reuse for signing after the explicit connection', async () => {
    const connection = await mwaAdapter.connect();
    mocks.authorize.mockClear();
    const transaction = {} as Transaction;
    mocks.signTransactions.mockResolvedValue([transaction]);
    await mwaAdapter.sign(connection, transaction);
    expect(mocks.authorize).toHaveBeenCalledExactlyOnceWith({
      chain: 'solana:mainnet', identity: { name: 'Lifeboat' }, auth_token: 'new-token',
    });
    expect(mocks.transact.mock.calls[1][1]).toEqual({ baseUri: result.wallet_uri_base });
    const trace = vi.mocked(console.info).mock.calls.flat().join('\n');
    expect(trace).toMatch(/\[LifeboatWalletSign\].*event=sign-result/);
    expect(trace).not.toContain(connection.authToken);
    expect(trace).not.toContain(connection.address);
  });

  it('identifies a wallet signing failure without exposing the request', async () => {
    const connection = await mwaAdapter.connect();
    const error = Object.assign(new Error('secret-token'), { code: -3 });
    mocks.signTransactions.mockRejectedValueOnce(error);
    await expect(mwaAdapter.sign(connection, {} as Transaction)).rejects.toBe(error);
    const trace = vi.mocked(console.info).mock.calls.flat().join('\n');
    expect(trace).toMatch(/phase=signing reason=not-signed/);
    expect(trace).not.toContain('secret-token');
  });
  it('renews authorization only for the native authorization-failed code', async () => {
    const connection = await mwaAdapter.connect();
    mocks.authorize.mockClear();
    mocks.authorize.mockRejectedValueOnce(Object.assign(new Error('secret-token'), {
      code: 'JSON_RPC_ERROR', userInfo: { jsonRpcErrorCode: -1 },
    }));
    const persist = vi.fn(async () => undefined);
    const transaction = {} as Transaction;
    mocks.signTransactions.mockImplementationOnce(async () => {
      expect(persist).toHaveBeenCalledWith(connection);
      return [transaction];
    });
    await mwaAdapter.sign(connection, transaction, persist);
    expect(mocks.authorize).toHaveBeenCalledTimes(2);
    expect(mocks.authorize.mock.calls[1][0]).not.toHaveProperty('auth_token');
    const trace = vi.mocked(console.info).mock.calls.flat().join('\n');
    expect(trace).toMatch(/event=authorize-retry .*reason=authorization-failed protocolCode=-1/);
    expect(trace).not.toContain('secret-token');
  });
  it.each([
    Object.assign(new Error('Timed out waiting for response'), { code: 'ERROR_SESSION_TIMEOUT' }),
    Object.assign(new Error('cancelled by user'), { code: 'ERROR_ASSOCIATION_CANCELLED' }),
    Object.assign(new Error('Invalid params'), { code: 'JSON_RPC_ERROR', userInfo: { jsonRpcErrorCode: -32602 } }),
  ])('does not open another connection prompt for other authorization errors', async error => {
    const connection = await mwaAdapter.connect();
    mocks.authorize.mockClear();
    mocks.authorize.mockRejectedValueOnce(error);
    const persist = vi.fn();
    await expect(mwaAdapter.sign(connection, {} as Transaction, persist)).rejects.toBe(error);
    expect(mocks.authorize).toHaveBeenCalledOnce();
    expect(mocks.signTransactions).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });
  it('does not request a signature if saving renewed authorization fails', async () => {
    const connection = await mwaAdapter.connect();
    const persist = vi.fn(async () => { throw new Error('disk error'); });
    await expect(mwaAdapter.sign(connection, {} as Transaction, persist)).rejects.toThrow(/disk error/);
    expect(mocks.signTransactions).not.toHaveBeenCalled();
  });

  it('does not include native request details or tokens in failure messages', () => {
    expect(walletConnectionFailure({ code: 'ERROR_WALLET_NOT_FOUND', message: 'secret-token' }, 'session').message)
      .toMatch(/No compatible Android wallet/);
    expect(walletConnectionFailure({ message: 'Local association cancelled by user: secret-token' }, 'session').message)
      .toMatch(/connection cancelled/);
    expect(walletConnectionFailure(new Error('secret-token'), 'authorization').message).not.toContain('secret-token');
  });
});
