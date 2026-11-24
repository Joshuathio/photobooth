import { describe, expect, it } from 'vitest';
import { FRAME_SETS, FRAMES, GACHA_SETS, fixedFrame, framesInSet, odds, roll, setById } from '../src/booth/gacha';

/** Small seeded PRNG so the distribution test is deterministic. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('gacha', () => {
  it('has two gacha sets with equal odds inside each set, plus the BINUS set', () => {
    expect(FRAME_SETS.map((s) => s.label)).toEqual(['Set A', 'Set B', 'BINUS × Academic Integrity']);
    expect(GACHA_SETS.map((s) => s.id)).toEqual(['A', 'B']);
    expect(framesInSet('A').map((f) => f.id)).toEqual(['a1', 'a2', 'a3', 'a4', 'a5']);
    expect(framesInSet('B').map((f) => f.id)).toEqual(['b1', 'b2', 'b3']);
    expect(framesInSet('AI').map((f) => f.id)).toEqual(['ai3', 'ai4']);
    expect(FRAMES.filter((f) => f.set !== 'AI').map((f) => f.name)).toEqual(
      Array.from({ length: 8 }, (_, i) => `Frame ${i + 1}`),
    );
    for (const set of GACHA_SETS) {
      const pool = framesInSet(set.id);
      for (const p of odds(pool)) expect(p).toBeCloseTo(100 / pool.length);
    }
  });

  it('gives the BINUS set a 3-photo and a 4-photo sheet, each with one row per photo', () => {
    expect(setById('AI').fixed).toBe(true);
    expect(fixedFrame('AI', 3).id).toBe('ai3');
    expect(fixedFrame('AI', 4).id).toBe('ai4');
    for (const n of [3, 4] as const) {
      const f = fixedFrame('AI', n);
      expect(f.photos).toBe(n);
      expect(f.art?.sheet).toBe(`/frames/binus/binus-${n}.png`);
      expect(f.grid?.rows).toHaveLength(n);
      expect(f.grid?.cols).toHaveLength(2);
      // Rows go down the sheet without overlapping, inside the 1200 × 1800 sheet.
      f.grid?.rows.forEach(([y0, y1], i, rows) => {
        expect(y1).toBeGreaterThan(y0);
        if (i > 0) expect(y0).toBeGreaterThanOrEqual(rows[i - 1][1]);
        expect(y1).toBeLessThanOrEqual(1800);
      });
    }
  });

  it('uses the designer artwork for Set A (Minimal) and Set B (Bifest)', () => {
    framesInSet('A').forEach((f, i) => {
      expect(f.art?.sheet).toBe(`/frames/minimal/minimal-${i + 1}.png`);
      expect(f.art?.thumb).toBe(`/frames/minimal/minimal-${i + 1}-thumb.jpg`);
    });
    framesInSet('B').forEach((f, i) => {
      expect(f.art?.sheet).toBe(`/frames/bifest/bifest-${i + 1}.png`);
      expect(f.art?.thumb).toBe(`/frames/bifest/bifest-${i + 1}-thumb.jpg`);
    });
    expect(FRAMES.every((f) => f.art)).toBe(true);
  });

  it('maps the random number onto the weights', () => {
    const b = framesInSet('B');
    expect(roll(b, 0).id).toBe('b1');
    expect(roll(b, 0.333).id).toBe('b1');
    expect(roll(b, 0.34).id).toBe('b2');
    expect(roll(b, 0.6).id).toBe('b2');
    expect(roll(b, 0.9999).id).toBe('b3');
  });

  it('respects uneven weights', () => {
    const pool = [
      { id: 'common', weight: 60 },
      { id: 'rare', weight: 30 },
      { id: 'legendary', weight: 10 },
    ];
    expect(odds(pool)).toEqual([60, 30, 10]);
    expect(roll(pool, 0.59).id).toBe('common');
    expect(roll(pool, 0.6).id).toBe('rare');
    expect(roll(pool, 0.95).id).toBe('legendary');
  });

  it('comes out close to a fifth each over many rolls in Set A', () => {
    const rand = mulberry32(42);
    const pool = framesInSet('A');
    const counts = new Map<string, number>();
    const n = 30_000;
    for (let i = 0; i < n; i++) {
      const id = roll(pool, rand()).id;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    for (const f of pool) {
      const share = (counts.get(f.id) ?? 0) / n;
      expect(share).toBeGreaterThan(0.18);
      expect(share).toBeLessThan(0.22);
    }
  });

  it('rejects an empty pool', () => {
    expect(() => roll([], 0.5)).toThrow();
  });
});
