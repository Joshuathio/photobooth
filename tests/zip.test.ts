import { describe, expect, it } from 'vitest';
import { crc32, zipStore } from '../src/shared/zip';

function join(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

describe('zip', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('writes local headers, a central directory and an end record', () => {
    const a = new TextEncoder().encode('hello');
    const b = new Uint8Array([1, 2, 3]);
    const bytes = join(zipStore([{ name: 'd/a.txt', data: a }, { name: 'd/b.bin', data: b }], new Date(2026, 10, 27, 8, 0, 0)));
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    const end = bytes.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
    const centralAt = view.getUint32(end + 16, true);
    expect(view.getUint32(centralAt, true)).toBe(0x02014b50);
    expect(view.getUint32(centralAt + 16, true)).toBe(crc32(a));
    // first entry: 30-byte header + name + data, so the second header follows right after
    expect(view.getUint32(30 + 7 + 5, true)).toBe(0x04034b50);
  });
});
