import { getDocumentAsync } from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import { checkRuntime, testKeypairJson } from '../diagnostics/runtime';

export async function checkPrivateFile() {
  const file = new File(Paths.document, 'lifeboat-runtime-test.json');
  try {
    file.write(testKeypairJson());
    return await checkRuntime(await file.text());
  } finally {
    if (file.exists) file.delete();
  }
}

export async function checkImportedTestFile() {
  const result = await getDocumentAsync({ type: '*/*', copyToCacheDirectory: false, multiple: false });
  if (result.canceled) return null;
  // Read content URI directly; never delete the user's original.
  const contents = await new File(result.assets[0].uri).text();
  let parsed: unknown;
  try { parsed = JSON.parse(contents); } catch { throw new Error('Expected test key JSON'); }
  if (JSON.stringify(parsed) !== testKeypairJson()) {
    throw new Error('Only tests/fixtures/runtime-keypair.json is accepted by diagnostics');
  }
  return checkRuntime(contents);
}
