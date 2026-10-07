import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'docs', 'wallet-identity');
const output = path.join(root, '.cache', 'wallet-identity-site');
const [html, association] = await Promise.all([
  readFile(path.join(source, 'index.html'), 'utf8'),
  readFile(path.join(source, 'assetlinks.json'), 'utf8'),
]);
const statements = JSON.parse(association);
if (!Array.isArray(statements) || statements.length !== 1 ||
    statements[0]?.target?.package_name !== 'app.lifeboat.mobile' ||
    !Array.isArray(statements[0].target.sha256_cert_fingerprints) ||
    statements[0].target.sha256_cert_fingerprints.length === 0 ||
    !statements[0].target.sha256_cert_fingerprints?.every(value => /^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/.test(value))) {
  throw new Error('Invalid public Android certificate association');
}
await mkdir(path.join(output, '.well-known'), { recursive: true });
await writeFile(path.join(output, 'index.html'), html);
await writeFile(path.join(output, '.nojekyll'), '');
await writeFile(path.join(output, '.well-known', 'assetlinks.json'), association);
console.log(`Prepared three public site files in ${output}`);
