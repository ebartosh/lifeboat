import {
  address, appendTransactionMessageInstruction, blockhash, compileTransaction,
  createTransactionMessage, getBase64Decoder, getBase64Encoder,
  getPublicKeyFromAddress, getTransactionDecoder, getTransactionEncoder,
  setTransactionMessageFeePayer, setTransactionMessageLifetimeUsingBlockhash,
  signTransaction, verifySignature,
} from '@solana/kit';
import { createOreAdapter } from '../protocols/ore-bundle';
import { readOreRewards } from '../operations/ore';
import { createOreClient } from '../operations/client';
import { parseKeypair } from '../core/wallet';
import fixture from './runtime-fixture.json' with { type: 'json' };

export type Check = { name: string; passed: boolean };
const same = (a: ArrayLike<number>, b: ArrayLike<number>) =>
  a.length === b.length && Array.from(a).every((value, i) => value === b[i]);

/** Entirely offline: no RPC client, simulation or send method. */
export async function checkRuntime(keypairJson: string): Promise<Check[]> {
  // Load the complete mobile composition (including RPC) without contacting any endpoint.
  createOreClient('http://127.0.0.1:8899');
  const results: Check[] = [];
  const check = (name: string, passed: boolean) => { results.push({ name, passed }); };
  check('bigint / u64', (2n ** 64n - 1n).toString() === '18446744073709551615');
  check('TextEncoder / TextDecoder',
    new TextDecoder().decode(new TextEncoder().encode('ORE — check')) === 'ORE — check');
  const bytes = Uint8Array.of(0, 1, 127, 128, 255);
  check('base64', getBase64Decoder().decode(bytes) === 'AAF/gP8=' &&
    same(getBase64Encoder().encode('AAF/gP8='), bytes));

  const adapter = createOreAdapter();
  const ore = adapter.programInterface;
  const referenceInstruction = await ore.buildInstruction('claimSol', {}, {
    signer: address('11111111111111111111111111111111'),
  });
  check('ORE Board PDA', referenceInstruction.accounts?.[1].address === fixture.board);
  check('ORE Miner PDA', referenceInstruction.accounts?.[2].address === fixture.miner);
  check('ClaimSOL bytes', same(referenceInstruction.data!, [3]));
  check('ClaimORE bytes', same(ore.encodeInstruction('claimOre', {
    bps: [16, 39, 0, 0, 0, 0, 0, 0],
  }), [4, 16, 39, 0, 0, 0, 0, 0, 0]));

  const signer = await parseKeypair(keypairJson);
  const instruction = await ore.buildInstruction('claimSol', {}, { signer: signer.address });
  const message = appendTransactionMessageInstruction(instruction,
    setTransactionMessageLifetimeUsingBlockhash({
      blockhash: blockhash('11111111111111111111111111111111'), lastValidBlockHeight: 1n,
    }, setTransactionMessageFeePayer(signer.address, createTransactionMessage({ version: 0 }))));
  const transaction = compileTransaction(message);
  const before = Uint8Array.from(transaction.messageBytes);
  const signed = await signTransaction([signer.keyPair], transaction);
  check('Message unchanged after signing', same(before, signed.messageBytes));
  const signature = signed.signatures[signer.address];
  check('Ed25519 signature', !!signature && await verifySignature(
    await getPublicKeyFromAddress(signer.address), signature, signed.messageBytes));
  const wire = getTransactionEncoder().encode(signed);
  const decoded = getTransactionDecoder().decode(wire);
  check('Transaction wire round trip', same(decoded.messageBytes, before) &&
    same(decoded.signatures[signer.address]!, signature!));
  if (signer.address === fixture.address) {
    check('Message matches Node fixture', getBase64Decoder().decode(before) === fixture.messageBase64);
    check('Signed wire matches Node fixture', getBase64Decoder().decode(wire) === fixture.wireBase64);
  }
  const missing = await readOreRewards({ adapter, wallet: signer.address, rpc: {
    getAccount: async key => key === adapter.programAddress
      ? { owner: address('11111111111111111111111111111111'), executable: true, data: new Uint8Array() }
      : null,
  } });
  check('ORE operations: missing Miner (offline)', missing.miner === null && missing.availableActions.length === 0);
  return results;
}

// Public, deterministic test key only. Never fund this address.
export const testKeypairJson = () => JSON.stringify(fixture.keypair);
