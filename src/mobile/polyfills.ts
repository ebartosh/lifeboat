import { install } from 'react-native-quick-crypto';

// Must execute before importing any Solana modules.
install();

// React 19.2's development renderer logs changed props to performance tracks with JSON.stringify(array) for arrays
// of primitives, so a re-render with a bigint[] prop (DAMM v2 reward amounts, DLMM shares) throws and unmounts the
// app. Only array calls without a replacer fall back; @solana/kit passes a replacer and records are objects, so both
// keep their behavior. The production renderer has no such logging.
if (__DEV__) {
  const stringify = JSON.stringify;
  JSON.stringify = ((value: unknown, replacer?: Parameters<typeof stringify>[1], space?: string | number) => {
    if (replacer != null || !Array.isArray(value)) return stringify(value, replacer as never, space);
    try { return stringify(value, null, space); }
    catch { return stringify(value, (_, v: unknown) => typeof v === 'bigint' ? v.toString() : v, space); }
  }) as typeof JSON.stringify;
}
