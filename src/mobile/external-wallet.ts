import { address, type Address, type Transaction } from '@solana/kit';
import type { PrivateFiles } from './storage';

export type ExternalConnection = {
  version: 1;
  address: Address;
  authToken: string;
  walletUriBase?: string;
};

export interface WalletAdapter {
  connect(): Promise<ExternalConnection>;
  sign(connection: ExternalConnection, transaction: Transaction,
    onAuthorized?: (connection: ExternalConnection) => Promise<void>): Promise<{ transaction: Transaction; connection: ExternalConnection }>;
}

/** Persists external-wallet authorization; private wallet keys stay in the wallet app. */
export class ExternalWallet {
  constructor(private readonly files: PrivateFiles, private readonly adapter: WalletAdapter) {}

  async read(): Promise<ExternalConnection | null> {
    const raw = await this.files.read('external-wallet.json');
    if (raw === null) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) throw new Error('Invalid wallet authorization');
    const candidate = value as Partial<ExternalConnection>;
    if (candidate.version !== 1 || typeof candidate.address !== 'string' ||
        typeof candidate.authToken !== 'string' || !candidate.authToken ||
        (candidate.walletUriBase !== undefined && typeof candidate.walletUriBase !== 'string')) {
      throw new Error('Invalid wallet authorization');
    }
    return { version: 1, address: address(candidate.address), authToken: candidate.authToken,
      ...(candidate.walletUriBase === undefined ? {} : { walletUriBase: candidate.walletUriBase }) };
  }

  async connect(): Promise<ExternalConnection> {
    const connection = await this.adapter.connect();
    await this.files.write('external-wallet.json', JSON.stringify(connection));
    return connection;
  }

  async sign(expected: Address, transaction: Transaction): Promise<Transaction> {
    const connection = await this.read();
    if (!connection || connection.address !== expected) throw new Error('External wallet changed');
    const signed = await this.adapter.sign(connection, transaction, async renewed => {
      if (renewed.address !== expected) throw new Error('Signing wallet changed');
      // Authorization renewal is valid even if the following signature request fails.
      await this.files.write('external-wallet.json', JSON.stringify(renewed));
    });
    if (signed.connection.address !== expected) throw new Error('Signing wallet changed');
    await this.files.write('external-wallet.json', JSON.stringify(signed.connection));
    return signed.transaction;
  }

  // Local only: MWA deauthorize would reopen the wallet app, and a token Lifeboat no longer holds cannot sign.
  async disconnect(): Promise<void> { await this.files.remove('external-wallet.json'); }
}
