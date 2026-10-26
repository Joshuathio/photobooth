import { describe, expect, it } from 'vitest';
import { FRAME_SETS, FRAMES, framesInSet, odds, roll } from '../src/booth/gacha';

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
  it('has three sets of three frames, each with equal odds inside its set', () => {
    expect(FRAME_SETS.map((s) => s.label)).toEqual(['Set A', 'Set B', 'Set C']);
    expect(FRAMES).toHaveLength(9);
    expect(framesInSet('A').map((f) => f.id)).toEqual(['f1', 'f2', 'f3']);
    expect(framesInSet('B').map((f) => f.id)).toEqual(['f4', 'f5', 'f6']);
    expect(framesInSet('C').map((f) => f.id)).toEqual(['f7', 'f8', 'f9']);
    for (const set of FRAME_SETS) {
      for (const p of odds(framesInSet(set.id))) expect(p).toBeCloseTo(100 / 3);
    }
  });

  it('maps the random number onto the weights', () => {
    const b = framesInSet('B');
    expect(roll(b, 0).id).toBe('f4');
    expect(roll(b, 0.333).id).toBe('f4');
    expect(roll(b, 0.34).id).toBe('f5');
    expect(roll(b, 0.6).id).toBe('f5');
    expect(roll(b, 0.9999).id).toBe('f6');
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

  it('comes out close to a third each over many rolls inside a set', () => {
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
      expect(share).toBeGreaterThan(0.31);
      expect(share).toBeLessThan(0.36);
    }
  });

  it('rejects an empty pool', () => {
    expect(() => roll([], 0.5)).toThrow();
  });
});
