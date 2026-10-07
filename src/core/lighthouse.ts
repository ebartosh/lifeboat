import type { ReadonlyUint8Array } from '@solana/kit';

export const LIGHTHOUSE_PROGRAM = 'L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95';
export type LighthouseAssertion = { field: string; operator: number | null; value: bigint | null };
export type LighthouseGuard = { kind: 'account-info' | 'token-account'; encoding: 'borsh' | 'compact'; assertions: LighthouseAssertion[] };

/** Bounded reader for the read-only assertion variants 6/10. Never accepts memory/write instructions. */
class Reader {
  offset = 0;
  constructor(readonly bytes: Uint8Array) {}
  take(count: number) {
    if (!Number.isSafeInteger(count) || count < 0 || this.offset + count > this.bytes.length) throw new Error('Invalid assertion');
    const result = this.bytes.subarray(this.offset, this.offset + count); this.offset += count; return result;
  }
  byte(max = 255) { const value = this.take(1)[0]; if (value > max) throw new Error('Invalid assertion'); return value; }
  u64() { const b = this.take(8); return new DataView(b.buffer, b.byteOffset, b.byteLength).getBigUint64(0, true); }
  compact() {
    let value = 0n;
    for (let i = 0; i < 10; i++) {
      const byte = this.byte();
      if (i === 9 && byte > 1) throw new Error('Invalid assertion');
      value |= BigInt(byte & 127) << BigInt(i * 7);
      if (!(byte & 128)) { if (i > 0 && byte === 0) throw new Error('Invalid assertion'); return value; }
    }
    throw new Error('Invalid assertion');
  }
}

// Layouts are pinned to Jac0xb/lighthouse 4c579479c98635e419b1b167f08be02a71604a71.
// Older deployed clients use a Borsh u32 vector length; newer source uses canonical LEB128.
export function decodeLighthouseGuard(data: ReadonlyUint8Array | undefined): LighthouseGuard | null {
  if (!data || data.length < 3 || data.length > 512) return null;
  for (const encoding of ['borsh', 'compact'] as const) {
    try {
      const r = new Reader(Uint8Array.from(data));
      const opcode = r.byte(); if (opcode !== 6 && opcode !== 10) continue;
      // Borsh serializes LogLevel by variant ordinal (0..6), not Rust repr values.
      r.byte(6);
      const count = encoding === 'compact' ? r.compact() : (() => {
        const b = r.take(4); return BigInt(new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(0, true));
      })();
      if (count < 1n || count > 16n) continue;
      const assertions: LighthouseAssertion[] = [];
      for (let i = 0; i < Number(count); i++) {
        const tag = r.byte(); let field: string; let value: bigint | null = null; let operator: number | null = null;
        if (opcode === 6) {
          field = ['lamports', 'data-length', 'owner', 'known-owner', 'rent-epoch', 'is-signer', 'is-writable', 'executable', 'data-hash'][tag];
          if (!field) throw new Error('Invalid assertion');
          if (tag === 0 || tag === 1 || tag === 4) { value = r.u64(); operator = r.byte(7); }
          else if (tag === 2) { r.take(32); operator = r.byte(1); }
          else if (tag === 3) { value = BigInt(r.byte(8)); operator = r.byte(1); }
          else if (tag >= 5 && tag <= 7) { value = BigInt(r.byte(1)); operator = r.byte(1); }
          else { r.take(32); r.compact(); r.compact(); }
        } else {
          field = ['mint', 'owner', 'amount', 'delegate', 'state', 'is-native', 'delegated-amount', 'close-authority', 'owner-is-derived'][tag];
          if (!field) throw new Error('Invalid assertion');
          if (tag === 0 || tag === 1) { r.take(32); operator = r.byte(1); }
          else if (tag === 2 || tag === 6) { value = r.u64(); operator = r.byte(7); }
          else if (tag === 3 || tag === 7) { if (r.byte(1)) r.take(32); operator = r.byte(1); }
          else if (tag === 4) { value = BigInt(r.byte(2)); operator = r.byte(7); }
          else if (tag === 5) { if (r.byte(1)) value = r.u64(); operator = r.byte(1); }
        }
        assertions.push({ field, value, operator });
      }
      if (r.offset !== r.bytes.length) continue;
      return { kind: opcode === 6 ? 'account-info' : 'token-account', encoding, assertions };
    } catch { /* Try the other documented vector encoding, then reject. */ }
  }
  return null;
}
