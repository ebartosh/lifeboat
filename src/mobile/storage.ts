import type { Address } from '@solana/kit';
import { parseKeypair } from '../core/wallet';
import { SolanaRpcClient } from '../core/rpc';

export type LocalFile = 'wallet.json' | 'external-wallet.json' | 'rpc.txt' | 'pending.json' | 'meteora-operation.json';
export interface PrivateFiles {
  read(name: LocalFile): Promise<string | null>;
  write(name: LocalFile, contents: string): Promise<void>;
  remove(name: LocalFile): Promise<void>;
}

/** Plaintext prototype storage. Neither errors nor public state contain private bytes. */
export class LocalSettings {
  constructor(private readonly files: PrivateFiles) {}

  async readWallet(): Promise<Address | null> {
    const contents = await this.files.read('wallet.json');
    return contents === null ? null : (await parseKeypair(contents)).address;
  }

  async importWallet(contents: string): Promise<Address> {
    const signer = await parseKeypair(contents);
    await this.files.write('wallet.json', JSON.stringify(JSON.parse(contents)));
    return signer.address;
  }

  async getSigner(expected: Address) {
    const contents = await this.files.read('wallet.json');
    if (contents === null) throw new Error('Wallet is missing');
    const signer = await parseKeypair(contents);
    if (signer.address !== expected) throw new Error('Wallet has changed');
    return signer;
  }

  deleteWallet() { return this.files.remove('wallet.json'); }

  async readRpc(): Promise<string> {
    const value = await this.files.read('rpc.txt');
    if (value === null) return '';
    new SolanaRpcClient(value);
    return value.trim();
  }

  async saveRpc(value: string): Promise<string> {
    const url = value.trim();
    new SolanaRpcClient(url);
    await this.files.write('rpc.txt', url);
    return url;
  }
}
