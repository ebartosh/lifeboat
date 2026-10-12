import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function font(file: string) {
  const data = readFileSync(new URL(`../assets/fonts/${file}.ttf`, import.meta.url));
  const tables = new Map<string, number>();
  for (let i = 0; i < data.readUInt16BE(4); i++) {
    const offset = 12 + i * 16;
    tables.set(data.toString('ascii', offset, offset + 4), data.readUInt32BE(offset + 8));
  }
  const cmap = tables.get('cmap')!;
  const maps: number[] = [];
  for (let i = 0; i < data.readUInt16BE(cmap + 2); i++) {
    const record = cmap + 4 + i * 8;
    const platform = data.readUInt16BE(record);
    if (platform === 0 || platform === 3) maps.push(cmap + data.readUInt32BE(record + 4));
  }
  function glyph(code: number) {
    for (const map of maps) {
      const format = data.readUInt16BE(map);
      if (format === 12) {
        for (let i = 0; i < data.readUInt32BE(map + 12); i++) {
          const group = map + 16 + i * 12;
          const start = data.readUInt32BE(group), end = data.readUInt32BE(group + 4);
          if (code >= start && code <= end) return data.readUInt32BE(group + 8) + code - start;
        }
      } else if (format === 4) {
        const count = data.readUInt16BE(map + 6) / 2;
        for (let i = 0; i < count; i++) {
          const end = data.readUInt16BE(map + 14 + i * 2);
          const start = data.readUInt16BE(map + 16 + count * 2 + i * 2);
          if (code < start || code > end) continue;
          const delta = data.readInt16BE(map + 16 + count * 4 + i * 2);
          const rangePos = map + 16 + count * 6 + i * 2;
          const range = data.readUInt16BE(rangePos);
          if (!range) return (code + delta) & 0xffff;
          const id = data.readUInt16BE(rangePos + range + (code - start) * 2);
          return id ? (id + delta) & 0xffff : 0;
        }
      }
    }
    return 0;
  }
  const metricCount = data.readUInt16BE(tables.get('hhea')! + 34);
  return { glyph, width: (char: string) => data.readUInt16BE(tables.get('hmtx')! + Math.min(glyph(char.charCodeAt(0)), metricCount - 1) * 4) };
}
describe('bundled interface fonts', () => {
  for (const [family, weights] of [['Mono', ['Regular', 'Medium', 'SemiBold']], ['Serif', ['Regular', 'Medium']]] as const) for (const weight of weights) {
    it(`${family} ${weight}: English, technical symbols, distinguishable glyphs and OFL`, () => {
      const parsed = font(`IBMPlex${family}-${weight}`);
      const required = '≈…>0123456789ORE/SOL.,:- ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
      for (const char of required) expect(parsed.glyph(char.codePointAt(0)!), char).toBeGreaterThan(0);
      expect(new Set([... '0O1lI'].map(char => parsed.glyph(char.charCodeAt(0)))).size).toBe(5);
      if (family === 'Mono') expect(new Set([... '0123456789OREsol'].map(parsed.width)).size).toBe(1);
      const license = readFileSync(new URL(`../assets/fonts/OFL-${family}.txt`, import.meta.url), 'utf8');
      expect(license).toContain('SIL OPEN FONT LICENSE Version 1.1');
      expect(license).toContain('IBM Corp.');
      const bundled = JSON.parse(readFileSync(new URL('../assets/fonts/license.json', import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
      expect(bundled.text.trim()).toBe(license.trim());
    });
  }
});

it('keeps actual text and control colors above the required contrast', () => {
  const theme = readFileSync(new URL('../src/mobile/theme.ts', import.meta.url), 'utf8');
  const colors = Object.fromEntries([...theme.matchAll(/(\w+): '(#[A-Fa-f0-9]{6})'/g)].map(match => [match[1], match[2]]));
  const luminance = (hex: string) => hex.slice(1).match(/../g)!.map(value => parseInt(value, 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!, 0);
  const contrast = (a: string, b: string) => {
    const values = [luminance(colors[a]!), luminance(colors[b]!)].sort((x, y) => y - x);
    return (values[0]! + 0.05) / (values[1]! + 0.05);
  };
  for (const [text, background] of [['navy','white'], ['blue','white'], ['navy','softOrange'],
    ['navy','lightBlue'], ['ink','orange'], ['navy','surface'], ['danger','white'],
    // Highlight groups must stay readable on white, on the selected row and on informational fills.
    ['secondary','white'], ['secondary','lightBlue'], ['header','white'], ['token','white'], ['token','softOrange'],
    ['address','white'], ['address','softOrange'], ['ok','white'], ['ok','softOrange'], ['ok','lightBlue'],
    ['danger','softOrange'], ['danger','lightBlue'], ['hotkey','white'], ['hotkey','lightBlue'],
    // Command bands: pressed primary action and disabled labels stay readable.
    ['ink','pressedOrange'], ['secondary','disabledFill']]) {
    expect(contrast(text!, background!), `${text}/${background}`).toBeGreaterThanOrEqual(4.5);
  }
  // Bracketed commands are identified by their text, so bands need no 3:1 edge. Non-text marks still do:
  // input borders, the refresh icon and the RPC status marks.
  for (const [mark, background] of [['navy','white'], ['navy','surface'], ['blue','white'], ['secondary','white'],
    ['ok','white'], ['danger','white']]) {
    expect(contrast(mark!, background!), `${mark}/${background}`).toBeGreaterThanOrEqual(3);
  }
});
