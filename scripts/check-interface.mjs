import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = process.cwd();
const output = path.join(root, '.cache/interface-check');
await mkdir(output, { recursive: true });
await build({ entryPoints: ['tests/ui/preview.jsx'], outfile: path.join(output, 'preview.js'), bundle: true,
  platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"',
    'process.env.EXPO_PUBLIC_LIFEBOAT_TEST_RPC':'undefined', __DEV__: 'true' },
  loader: { '.ttf': 'dataurl' }, resolveExtensions: ['.web.tsx','.web.ts','.web.js','.tsx','.ts','.jsx','.js','.json'],
  plugins: [{ name: 'isolated-native-preview', setup(builder) {
    builder.onResolve({ filter: /^react-native$/ }, () => ({ path: path.join(root, 'tests/ui/native-web.jsx') }));
    builder.onResolve({ filter: /\/native-storage$/ }, () => ({ path: path.join(root, 'tests/ui/storage.js') }));
    builder.onResolve({ filter: /^expo-(font|clipboard)$/ }, args => ({ path: args.path, namespace: 'preview' }));
    builder.onLoad({ filter: /.*/, namespace: 'preview' }, args => ({ contents: args.path === 'expo-font'
      ? 'export const useFonts = () => [true, null];'
      : 'export const setStringAsync = async value => { window.copied = value; };' }));
  } }],
});
const faces = ['Mono-Regular','Mono-Medium','Serif-Regular','Serif-Medium'].map(name =>
  `@font-face{font-family:IBMPlex${name};src:url(/fonts/IBMPlex${name}.ttf)}`).join('');
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${faces}html,body,#root{height:100%;margin:0}#root{display:flex;flex-direction:column}*{box-sizing:border-box}</style><div id="root"></div><script src="/preview.js"></script></html>`;
const server = createServer(async (req, res) => {
  try {
    if (req.url?.startsWith('/fonts/')) {
      res.setHeader('content-type','font/ttf'); res.end(await readFile(path.join(root,'assets/fonts',path.basename(req.url))));
    } else if (req.url === '/preview.js') {
      res.setHeader('content-type','text/javascript; charset=utf-8'); res.end(await readFile(path.join(output,'preview.js')));
    } else { res.setHeader('content-type','text/html; charset=utf-8'); res.end(html); }
  } catch { res.statusCode = 404; res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const executablePath = process.env.INTERFACE_BROWSER || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium', '/usr/bin/google-chrome',
].find(existsSync);
let browser;
const results = [];
try {
  browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 360, height: 800 } });
  await page.route('https://api.mainnet.solana.com/**', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ jsonrpc: '2.0', id: route.request().postDataJSON()?.id,
      error: { code: -32000, message: 'Offline interface fixture' } }),
  }));
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  async function open(scenario, scale = 1, width = 360, height = 800) {
    await page.setViewportSize({ width, height });
    await page.goto(`http://127.0.0.1:${port}/?scenario=${scenario}&scale=${scale}`);
    try { await page.getByText('Lifeboat', { exact: true }).first().waitFor(); }
    catch (error) {
      await page.screenshot({path:path.join(output,`failure-${scenario}-${scale}.png`),fullPage:true}).catch(()=>{});
      throw new Error(`${scenario} at ${scale}× failed to render; browser errors: ${JSON.stringify(errors)}`,{cause:error});
    }
    await page.evaluate(() => document.fonts.ready);
  }
  async function check(name) {
    const issues = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(el => {
      const b = el.getBoundingClientRect();
      return b.width > 0 && b.height > 0 && (b.left < -1 || b.right > innerWidth + 1);
    }).map(el => ({ text: el.textContent?.slice(0,60), width: el.getBoundingClientRect().width })));
    assert.deepEqual(issues, [], `${name}: horizontal overflow`);
    const small = await page.locator('[role="button"], [role="tab"], input').evaluateAll(els => els.filter(el => {
      const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 && (b.width < 48 || b.height < 48);
    }).map(el => el.textContent));
    assert.deepEqual(small, [], `${name}: targets under 48px`);
    await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
    results.push(name);
  }
  for (const scale of [1,1.3,2]) {
    for (const scenario of ['no-wallet','ore','loading','empty','error','expired','kamino','review','wallet-review','wallet-check','wallet-check-busy','unknown','meteora','meteora-loading','meteora-empty','meteora-error','meteora-expired','meteora-review','meteora-wallet-review','meteora-partial','meteora-unknown','meteora-transfer-fees','meteora-transfer-fees-review']) {
      await open(scenario, scale); await check(`${scenario}-360-${scale}`);
    }
  }
  await open('meteora-transfer-fees-review',2);
  await page.getByText(/Gross transfer:.*Withheld transfer fee:/).waitFor();
  await page.getByText(/^Future transfer fees.*Withheld fees are unavailable to spend/).waitFor();
  await page.getByText(/Gross transfer:.*Withheld transfer fee:/).scrollIntoViewIfNeeded();
  await check('meteora-transfer-fees-review-fee-2');
  await open('expired',2);
  await page.getByText(/Transaction expired\. Nothing was sent/).waitFor();
  await page.getByText(/Check the details before approving/).waitFor();
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('button',{name:'Operation details',exact:true}).click();
  await page.getByText(/without long pauses/).waitFor();
  await open('meteora-expired',2);
  await page.getByText(/This step expired before sending\. Confirmed steps are kept/).waitFor();
  await page.getByRole('button',{name:'Resume withdrawal',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>window.calls),['resume']);
  await open('wallet-check',2);
  await page.getByRole('button',{name:'Sign memo without sending',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>window.calls),['memo-check']);
  await page.getByText('Memo signature verified. Nothing was sent, and no network fee was paid.',{exact:true}).waitFor();
  await check('wallet-check-success-2');
  await open('wallet-check-busy');
  assert.equal(await page.getByRole('button',{name:'Sign memo without sending',exact:true}).isDisabled(),true);
  assert.equal(await page.getByRole('button',{name:'Back',exact:true}).count(),0);
  await open('ore',1,900); await check('ore-wide');
  await open('ore',2,900); await check('ore-wide-2');
  await open('meteora',1,900); await check('meteora-wide');
  await open('meteora',2,900); await check('meteora-wide-2');
  await open('meteora');
  await page.getByRole('button',{name:/USDC \/ WSOL\. DLMM/}).click();
  assert.deepEqual(await page.evaluate(()=>window.calls),[],'Meteora selection must not submit');
  await page.getByRole('button',{name:'Reverse order',exact:true}).click();
  assert.match(await page.getByRole('button',{name:/USDC \/ WSOL\. DLMM/}).textContent(),/^> USDC/);
  await page.getByRole('button',{name:'Full details',exact:true}).click();
  await page.getByRole('button',{name:'Copy: Position',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.copied),'7YttLkHDoNj9wyDur5H7Myd5FWGaBMPLys5aeQ3dJKXS');
  await check('meteora-details');
  await page.getByRole('button',{name:'Back',exact:true}).click();
  await page.getByRole('button',{name:/Unavailable position\. DLMM/}).click();
  assert.equal(await page.getByRole('button',{name:'Withdraw all',exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:/USDC \/ WSOL\. DLMM/}).click();
  await page.getByRole('button',{name:'Withdraw all',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>window.calls),['7YttLkHDoNj9wyDur5H7Myd5FWGaBMPLys5aeQ3dJKXS']);
  await open('meteora-partial',2);
  await page.getByRole('button',{name:'Resume withdrawal',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>window.calls),['resume']);
  await check('meteora-resume-2');
  await open('meteora-review',2);
  await page.getByRole('button',{name:'Sign and send',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>window.calls),[true]);
  await check('meteora-sending-2');
  await open('meteora-unknown');
  assert.equal(await page.getByRole('button',{name:'Resume withdrawal',exact:true}).count(),0);
  await page.getByRole('button',{name:'Check status',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>window.calls),['check']);
  await open('no-wallet');
  assert.equal(await page.getByText('MAINNET', { exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Fonts and license', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Connect', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Refresh', exact: true }).isDisabled(), true);
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
    await page.getByText('External wallet connected.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Wallet details', exact: true }).click();
    await page.getByRole('button', { name: 'Disconnect wallet', exact: true }).click();
    await page.getByText('Wallet not connected', { exact: true }).waitFor();
  }
  assert.deepEqual(await page.evaluate(() => window.walletCalls), ['connect','disconnect','connect','disconnect']);
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await page.getByText('External wallet connected.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Refresh', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Switch wallet', exact: true }).count(), 0);
  const walletButton = await page.getByRole('button', { name: 'Wallet details', exact: true }).boundingBox();
  const refreshButton = await page.getByRole('button', { name: 'Refresh', exact: true }).boundingBox();
  const title = await page.getByText('Lifeboat', { exact: true }).first().boundingBox();
  assert.ok(walletButton.x > title.x && refreshButton.x > walletButton.x, 'Wallet and refresh commands belong at the upper right');
  assert.equal(walletButton.y, refreshButton.y, 'Refresh must be next to the wallet command');
  assert.ok(walletButton.y < title.y + title.height, 'Commands must share the masthead at normal text size');
  assert.equal((await page.getByRole('button', { name: 'Refresh', exact: true }).textContent()).trim(), '↻');
  let rpcRequests = 0;
  const countRpc = request => { if (request.url().startsWith('https://api.mainnet.solana.com')) rpcRequests++; };
  page.on('request', countRpc);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh', exact: true }).waitFor();
  assert.ok(rpcRequests > 0, 'Header refresh must reload positions');
  page.off('request', countRpc);
  await check('connected-wallet-header');
  await page.evaluate(() => { window.cancelNextWalletConnection = true; });
  await page.getByRole('button', { name: 'Wallet details', exact: true }).click();
  await page.getByRole('button', { name: 'Switch wallet', exact: true }).click();
  await page.getByText(/Could not connect the wallet/).waitFor();
  await page.getByRole('button', { name: 'Wallet details', exact: true }).click();
  await page.getByText('External wallet', { exact: true }).waitFor();
  assert.equal(await page.getByText(/Import JSON|Local key|Delete local key|Key saved on device/).count(), 0);
  assert.deepEqual(await page.evaluate(() => window.walletCalls), ['connect','disconnect','connect','disconnect','connect','connect']);
  await check('external-wallet-details');
  for (const scale of [1, 1.3, 2]) {
    await open('no-wallet', scale);
    await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
    await page.getByText('External wallet connected.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Refresh', exact: true }).waitFor();
    await check(`app-connected-header-360-${scale}`);
  }
  await open('ore');
  await page.getByRole('button', { name: 'ORE rewards. Rewards.' }).click();
  assert.deepEqual(await page.evaluate(() => window.calls), [], 'Selection must not run an operation');
  await page.getByRole('button', { name: 'Full details', exact: true }).click();
  await page.getByRole('button', { name: 'Copy: Miner', exact: true }).click();
  assert.equal(await page.evaluate(() => window.copied), '7YttLkHDoNj9wyDur5H7Myd5FWGaBMPLys5aeQ3dJKXS');
  await check('ore-details');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Direct staking. ORE staking.' }).click();
  await page.getByRole('button', { name: 'Withdraw ORE', exact: true }).click();
  await page.getByLabel('Withdrawal amount, ORE', { exact: true }).fill('0.00000000001');
  await page.setViewportSize({ width: 360, height: 400 });
  await check('ore-input-low-screen');
  await page.getByRole('button', { name: 'Prepare ORE withdrawal', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.calls), ['0.00000000001']);
  await open('kamino');
  await page.getByRole('button', { name: /Debt SOL\. Recheck/ }).click();
  await page.getByRole('button', { name: 'Reverse order', exact: true }).click();
  assert.match(await page.getByRole('button', { name: /Debt SOL\. Recheck/ }).textContent(), /^> Debt SOL/);
  await page.getByRole('button', { name: 'Repay SOL', exact: true }).click();
  await page.getByLabel('Amount, SOL', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'Prepare operation', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.calls), []);
  await page.getByText(/Error: Enter a positive/).waitFor();
  await page.getByLabel('Amount, SOL', { exact: true }).fill('all');
  await check('kamino-input');
  await page.getByRole('button', { name: 'Prepare operation', exact: true }).click();
  const requests = await page.evaluate(() => window.calls);
  assert.equal(requests[0].token, 'SOL'); assert.equal(requests[0].amount, 'all');
  await open('review',2);
  await page.getByRole('button', { name: 'Sign and send', exact: true }).scrollIntoViewIfNeeded();
  await check('review-actions-2');
  await page.getByRole('button', { name: 'Sign and send', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Sign and send', exact: true }).count(), 0);
  await check('sending-2');
  await open('wallet-review',2);
  await page.getByText('Priority fee included above: 0.000024 SOL', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Sign and send', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Send transaction', exact: true }).scrollIntoViewIfNeeded();
  await check('wallet-review-actions-2');
  await page.getByRole('button', { name: 'Send transaction', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.calls), [true]);
  assert.equal(await page.getByRole('button', { name: 'Send transaction', exact: true }).count(), 0);
  await open('unknown');
  await page.getByRole('button', { name: 'Check status', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.calls), ['check']);
  assert.equal(await page.getByRole('button', { name: 'Check status', exact: true }).count(), 0);
  assert.deepEqual(errors, [], 'Browser runtime errors');
  await writeFile(path.join(output,'report.json'),JSON.stringify({ checks: results, errors, note: 'RN Web preview. Text metrics emulate fontScale; native Android behavior requires device QA.' },null,2));
  console.log(`Passed ${results.length} visual/layout cases and interaction checks. Artifacts: ${output}`);
} finally { await browser?.close(); server.close(); }

