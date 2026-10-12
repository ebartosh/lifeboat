import { getAddressDecoder, getBase64Encoder, type Address, type Transaction } from '@solana/kit';
import { AppState } from 'react-native';
import { transact } from '@solana-mobile/mobile-wallet-adapter-protocol-kit';
import type { ExternalConnection, WalletAdapter } from './external-wallet';
import { walletConnectionFailure } from './wallet-connection-error';
import { startWalletConnectionTrace, startWalletSigningTrace } from './wallet-diagnostics';
import { walletProtocolErrorCode } from '../core/wallet-errors';
import { createWalletIdentity } from './wallet-identity';

const walletIdentity = () => createWalletIdentity(process.env.EXPO_PUBLIC_WALLET_IDENTITY_URI);
const chain = 'solana:mainnet';

function accountAddress(encoded: string): Address {
  return getAddressDecoder().decode(getBase64Encoder().encode(encoded));
}

function waitUntilForeground(): Promise<void> {
  if (AppState.currentState === 'active') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { subscription.remove(); reject(new Error('Wallet did not return to app')); }, 30_000);
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') { clearTimeout(timer); subscription.remove(); resolve(); }
    });
  });
}

export const mwaAdapter: WalletAdapter = {
  async connect() {
    const trace = startWalletConnectionTrace(AppState.currentState);
    let phase: 'session' | 'authorization' | 'return' = 'session';
    try {
      const identity = walletIdentity();
      const result = await transact(async wallet => {
        trace.event('session-ready');
        phase = 'authorization';
        // A user choosing Connect/Switch wallet needs a fresh authorization and
        // the Android wallet chooser, rather than silent access to the old account.
        trace.event('authorize-start');
        const authorization = await wallet.authorize({ chain, identity });
        trace.event('authorize-result');
        return authorization;
      });
      trace.event('session-closed');
      phase = 'return';
      trace.event('foreground-wait');
      await waitUntilForeground();
      const first = result.accounts[0];
      if (!first || !result.auth_token) throw new Error('Wallet returned no account');
      const connection = { version: 1 as const, address: accountAddress(first.address), authToken: result.auth_token,
        ...(result.wallet_uri_base ? { walletUriBase: result.wallet_uri_base } : {}) };
      trace.event('success');
      return connection;
    } catch (error) {
      trace.failure(phase, error);
      throw walletConnectionFailure(error, phase);
    }
  },

  async sign(connection, transaction, onAuthorized) {
    const trace = startWalletSigningTrace();
    let phase: 'session' | 'authorization' | 'account' | 'storage' | 'signing' | 'close' | 'return' = 'session';
    try {
      const identity = walletIdentity();
      const signed = await transact(async wallet => {
        trace.event('session-ready');
        // Diagnostic only: a capabilities failure must not change authorization or signing behavior.
        try { trace.capabilities(await wallet.getCapabilities()); }
        catch (error) { trace.capabilitiesFailure(error); }
        phase = 'authorization';
        let result;
        try {
          trace.event('authorize-start');
          result = await wallet.authorize({ chain, identity, auth_token: connection.authToken });
        } catch (error) {
          const retry = walletProtocolErrorCode(error) === -1;
          trace.authorizationFailure(error, retry);
          if (!retry) throw error;
          // Only ERROR_AUTHORIZATION_FAILED calls for a fresh connection prompt.
          result = await wallet.authorize({ chain, identity });
        }
        trace.event('authorize-result');
        phase = 'account';
        trace.event('account-check');
        if (!result.accounts[0] || accountAddress(result.accounts[0].address) !== connection.address) {
          throw new Error('Signing account changed');
        }
        if (!result.auth_token) throw new Error('Wallet returned no authorization token');
        const walletUriBase = result.wallet_uri_base ?? connection.walletUriBase;
        const renewed: ExternalConnection = { version: 1, address: connection.address, authToken: result.auth_token,
          ...(walletUriBase ? { walletUriBase } : {}) };
        phase = 'storage';
        trace.event('authorization-save');
        await onAuthorized?.(renewed);
        trace.event('authorization-saved');
        phase = 'signing';
        trace.event('sign-start');
        const transactions = await wallet.signTransactions({ transactions: [transaction] });
        trace.event('sign-result');
        if (transactions.length !== 1) throw new Error('Wallet returned an unexpected transaction count');
        phase = 'close';
        return { transaction: transactions[0], connection: renewed };
      }, connection.walletUriBase ? { baseUri: connection.walletUriBase } : undefined);
      trace.event('session-closed');
      phase = 'return';
      trace.event('foreground-wait');
      await waitUntilForeground();
      trace.event('success');
      return signed;
    } catch (error) { trace.failure(phase, error); throw error; }
  },
};
