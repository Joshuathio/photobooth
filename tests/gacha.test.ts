import { describe, expect, it } from 'vitest';
import { FRAMES, frameById, isFrameId, odds, roll } from '../src/booth/gacha';

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

describe('frames', () => {
  it('offers the five Dearly frames to pick from', () => {
    expect(FRAMES.map((f) => f.id)).toEqual(['a1', 'a2', 'a3', 'a4', 'a5']);
    expect(FRAMES.map((f) => f.name)).toEqual(Array.from({ length: 5 }, (_, i) => `Frame ${i + 1}`));
  });

  it('uses the designer artwork (Minimal) for every frame', () => {
    FRAMES.forEach((f, i) => {
      expect(f.art?.sheet).toBe(`/frames/minimal/minimal-${i + 1}.png`);
      expect(f.art?.thumb).toBe(`/frames/minimal/minimal-${i + 1}-thumb.jpg`);
    });
  });

  it('recognises frame ids and falls back to the first frame for unknown ones', () => {
    expect(isFrameId('a3')).toBe(true);
    expect(isFrameId('b1')).toBe(false);
    expect(isFrameId('ai4')).toBe(false);
    expect(isFrameId(undefined)).toBe(false);
    expect(frameById('a5').name).toBe('Frame 5');
    expect(frameById('nope').id).toBe('a1');
  });
});

describe('weighted pick (kept for a future random frame)', () => {
  it('maps the random number onto the weights', () => {
    expect(roll(FRAMES, 0).id).toBe('a1');
    expect(roll(FRAMES, 0.19).id).toBe('a1');
    expect(roll(FRAMES, 0.21).id).toBe('a2');
    expect(roll(FRAMES, 0.5).id).toBe('a3');
    expect(roll(FRAMES, 0.9999).id).toBe('a5');
  });

  it('gives every frame the same odds', () => {
    for (const p of odds(FRAMES)) expect(p).toBeCloseTo(100 / FRAMES.length);
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

  it('comes out close to a fifth each over many rolls', () => {
    const rand = mulberry32(42);
    const counts = new Map<string, number>();
    const n = 30_000;
    for (let i = 0; i < n; i++) {
      const id = roll(FRAMES, rand()).id;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    for (const f of FRAMES) {
      const share = (counts.get(f.id) ?? 0) / n;
      expect(share).toBeGreaterThan(0.18);
      expect(share).toBeLessThan(0.22);
    }
  });

  it('rejects an empty pool', () => {
    expect(() => roll([], 0.5)).toThrow();
  });
});
