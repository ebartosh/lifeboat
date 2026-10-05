import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdirSync, appendFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { filterWalletLog } from './wallet-log-filter.mjs';

const serial = process.argv[2];
const snapshot = process.argv.includes('--snapshot');
if (!serial || serial.startsWith('-')) {
  console.error('Usage: node scripts/capture-wallet-logs.mjs DEVICE_SERIAL [--snapshot]');
  process.exit(1);
}
const adb = path.join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk', 'platform-tools', 'adb.exe');
if (!existsSync(adb)) throw new Error('Android SDK adb.exe was not found at the verified location.');
const adbRead = (...args) => execFileSync(adb, ['-s', serial, ...args], { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
adbRead('get-state');
const output = path.resolve('.cache', `wallet-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(output, 'Lifeboat MWA diagnostic capture v1\n');
const emit = line => { console.log(line); appendFileSync(output, `${line}\n`); };
for (const [label, property] of [['Android', 'ro.build.version.release'], ['Model', 'ro.product.model']]) {
  const value = adbRead('shell', 'getprop', property).trim().replace(/[\r\n]/g, ' ');
  emit(`${label}: ${value}`);
}
for (const [label, name] of [['Lifeboat', 'app.lifeboat.mobile'], ['Phantom', 'app.phantom'], ['Solflare', 'com.solflare.mobile']]) {
  // Inspect package metadata in memory; never persist the full dumpsys output.
  const info = adbRead('shell', 'dumpsys', 'package', name);
  const version = info.match(/^\s*versionName=(\S+)/m)?.[1] ?? 'not found';
  emit(`${label} version: ${version}`);
}
emit(snapshot ? 'Reading recent diagnostic milestones.' : 'Capture started. Reproduce one operation, wait for the result, return to Lifeboat, then press Ctrl+C.');
console.log(`Filtered log: ${output}`);
const capture = spawn(adb, ['-s', serial, 'logcat', '-v', 'threadtime', ...(snapshot ? ['-d'] : ['-T', '1']),
  'ReactNativeJS:I', 'SolanaMobileWalletAdapterModule:D', '*:S'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
const lines = createInterface({ input: capture.stdout });
lines.on('line', line => { const safe = filterWalletLog(line); if (safe) emit(safe); });
capture.stderr.on('data', () => console.error('adb reported a capture error; check the USB connection.'));
capture.on('error', () => { console.error('Could not start adb logcat.'); process.exitCode = 1; });
capture.on('exit', code => { if (code && code !== 0) process.exitCode = 1; });
process.on('SIGINT', () => { lines.close(); capture.kill(); console.log(`Saved filtered log: ${output}`); });
