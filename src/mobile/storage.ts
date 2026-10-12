import { SolanaRpcClient } from '../core/rpc';

export type LocalFile = 'external-wallet.json' | 'rpc.txt' | 'pending.json' | 'meteora-operation.json' | 'orca-operation.json';
export interface PrivateFiles {
  read(name: LocalFile): Promise<string | null>;
  write(name: LocalFile, contents: string): Promise<void>;
  remove(name: LocalFile): Promise<void>;
}

/** RPC settings stored in the private app directory. */
export class LocalSettings {
  constructor(private readonly files: PrivateFiles) {}

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
