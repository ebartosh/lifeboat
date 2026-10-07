import { File, Paths } from 'expo-file-system';
import type { PrivateFiles, LocalFile } from './storage';
import { createPendingStore } from './pending-store';
import { ExternalWallet } from './external-wallet';
import { mwaAdapter } from './mwa-adapter';

const file = (name: LocalFile) => new File(Paths.document, `lifeboat-${name}`);
const staging = (name: LocalFile) => new File(Paths.document, `lifeboat-${name}.tmp`);

const files: PrivateFiles = {
  async read(name) {
    // Remove only an interrupted write for the requested app-owned record.
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

export const pendingStore = createPendingStore(files);
export const externalWallet = new ExternalWallet(files, mwaAdapter);
