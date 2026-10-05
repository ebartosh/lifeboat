import { File, Paths } from 'expo-file-system';
import { getDocumentAsync } from 'expo-document-picker';
import { LocalSettings, type PrivateFiles, type LocalFile } from './storage';
import { createPendingStore } from './pending-store';
import { ExternalWallet } from './external-wallet';
import { mwaAdapter } from './mwa-adapter';

const file = (name: LocalFile) => new File(Paths.document, `lifeboat-${name}`);
const staging = (name: LocalFile) => new File(Paths.document, `lifeboat-${name}.tmp`);

const files: PrivateFiles = {
  async read(name) {
    // Remove an app-owned interrupted write; never touch the selected source document.
    const temporary = staging(name);
    if (temporary.exists) temporary.delete();
    const target = file(name);
    return target.exists ? await target.text() : null;
  },
  async write(name, contents) {
    const temporary = staging(name);
    try {
      temporary.write(contents);
      if (await temporary.text() !== contents) throw new Error('Storage verification failed');
      await temporary.move(file(name), { overwrite: true });
    } finally {
      // move changes temporary.uri: resolve the original path again before deleting.
      const leftover = staging(name);
      if (leftover.exists) leftover.delete();
    }
  },
  async remove(name) {
    const temporary = staging(name);
    if (temporary.exists) temporary.delete();
    const target = file(name);
    if (target.exists) target.delete();
  },
};

export const localSettings = new LocalSettings(files);
export const pendingStore = createPendingStore(files);
export const externalWallet = new ExternalWallet(files, mwaAdapter);

export async function pickWallet(): Promise<string | null> {
  const result = await getDocumentAsync({ type: '*/*', multiple: false, copyToCacheDirectory: false });
  if (result.canceled) return null;
  const selected = new File(result.assets[0].uri);
  if ((result.assets[0].size ?? selected.size) > 4096) throw new Error('Invalid keypair file');
  const contents = await selected.text();
  if (contents.length > 4096) throw new Error('Invalid keypair file');
  return contents;
}
