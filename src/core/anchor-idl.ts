import { getAddressDecoder } from '@solana/kit';

type Check = (value: unknown, message: string) => asserts value;
type FieldType = string | { array: [FieldType, number] } | { defined: { name: string } };
type Field = { name: string; type: FieldType };
type IdlType = { name: string; type: { kind?: string; fields?: unknown[] } };
const sizes: Record<string, number> = { u8: 1, u16: 2, u32: 4, i32: 4, u64: 8, i64: 8, u128: 16, pubkey: 32 };

/**
 * Sequential struct reader for Anchor 0.30+ IDLs (`pubkey`, `{ defined: { name } }`). Bundled zero-copy
 * types carry explicit padding, so fields are read in order like Anchor's Borsh coder; host ABI alignment
 * is never applied to u128.
 */
export function createIdlDecoder(types: readonly IdlType[], check: Check) {
  const definitions = new Map(types.filter(item => item.type.fields).map(item => [item.name, item.type.fields as Field[]]));
  function read(data: Uint8Array, cursor: { offset: number }, type: FieldType): unknown {
    if (typeof type !== 'string') {
      if ('array' in type) return Array.from({ length: type.array[1] }, () => read(data, cursor, type.array[0]));
      return readStruct(data, cursor, type.defined.name);
    }
    const size = sizes[type];
    check(size !== undefined && cursor.offset + size <= data.length, 'truncated or unknown IDL field');
    const offset = cursor.offset; cursor.offset += size;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (type === 'pubkey') return getAddressDecoder().decode(data.subarray(offset, offset + 32));
    if (type === 'u8') return data[offset];
    if (type === 'u16') return view.getUint16(offset, true);
    if (type === 'u32') return view.getUint32(offset, true);
    if (type === 'i32') return view.getInt32(offset, true);
    if (type === 'i64') return view.getBigInt64(offset, true);
    if (type === 'u128') return view.getBigUint64(offset, true) | view.getBigUint64(offset + 8, true) << 64n;
    return view.getBigUint64(offset, true);
  }
  function readStruct(data: Uint8Array, cursor: { offset: number }, name: string): Record<string, unknown> {
    const fields = definitions.get(name); check(fields, `unknown IDL type ${name}`);
    return Object.fromEntries(fields.map(field => [field.name, read(data, cursor, field.type)]));
  }
  return { readStruct };
}
