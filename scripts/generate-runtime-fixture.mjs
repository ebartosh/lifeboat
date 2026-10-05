import { mkdir, writeFile } from 'node:fs/promises';
import * as kit from '@solana/kit';
import { ProgramInterface } from '../src/core/program-interface.ts';
import idl from '../src/protocols/ore/ore.idl.json' with { type: 'json' };

const signer = await kit.createKeyPairSignerFromPrivateKeyBytes(
  Uint8Array.from({ length: 32 }, (_, i) => i + 1), true);
const keypair = [...Array.from({ length: 32 }, (_, i) => i + 1),
  ...kit.getAddressEncoder().encode(signer.address)];
const ore = new ProgramInterface(idl);
const ix = await ore.buildInstruction('claimSol', {}, { signer: signer.address });
const message = kit.appendTransactionMessageInstruction(ix,
  kit.setTransactionMessageLifetimeUsingBlockhash({
    blockhash: kit.blockhash('11111111111111111111111111111111'), lastValidBlockHeight: 1n,
  }, kit.setTransactionMessageFeePayer(signer.address, kit.createTransactionMessage({ version: 0 }))));
const transaction = await kit.signTransaction([signer.keyPair], kit.compileTransaction(message));
await writeFile(new URL('../src/diagnostics/runtime-fixture.json', import.meta.url), JSON.stringify({
  description: 'PUBLIC TEST KEY. Never fund. Node @solana/kit 7.1.1 encoding oracle; PDA references from CLI tests.',
  address: signer.address, keypair,
  board: 'BrcSxdp1nXFzou1YyDnQJcPNBNHgoypZmTsyKBSLLXzi',
  miner: 'DAZVMv5nFB4mGM5CRCt5h4xK8eoxMa4H5adtS3RQ4TK2',
  messageBase64: kit.getBase64Decoder().decode(transaction.messageBytes),
  wireBase64: kit.getBase64Decoder().decode(kit.getTransactionEncoder().encode(transaction)),
}, null, 2) + '\n');
await mkdir(new URL('../tests/fixtures/', import.meta.url), { recursive: true });
await writeFile(new URL('../tests/fixtures/runtime-keypair.json', import.meta.url),
  JSON.stringify(keypair) + '\n');
