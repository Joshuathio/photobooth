import { describe, expect, it } from 'vitest';
import { DECKS, LAST_PROMPT, SHOTS, type Deck, type DeckId } from '../src/booth/config';
import { PromptBag } from '../src/booth/prompts';

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const POOLED = (Object.keys(DECKS) as DeckId[]).filter((id) => !(DECKS[id] as Deck).free);

describe('prompt pools', () => {
  it('has 24 different prompts in every gaya, without "Bebas" in the pool', () => {
    expect(POOLED).toEqual(['BESTIE', 'COUPLE', 'CHAOS', 'CORPORATE', 'KULIAH']);
    for (const id of POOLED) {
      const pool = DECKS[id].prompts;
      expect(pool).toHaveLength(24);
      expect(new Set(pool).size).toBe(24);
      expect(pool.some((p) => p.startsWith('Bebas'))).toBe(false);
    }
  });

  it('has a free "Bebas" gaya with one cue per shot', () => {
    const bebas: Deck = DECKS.BEBAS;
    expect(bebas.free).toBe(true);
    expect(bebas.prompts).toHaveLength(SHOTS);
  });
});

describe('PromptBag', () => {
  it('gives 7 different pool prompts and ends on the free shot', () => {
    const bag = new PromptBag(mulberry32(1));
    const plan = bag.draw('COUPLE');
    expect(plan).toHaveLength(SHOTS);
    expect(plan[SHOTS - 1]).toBe(LAST_PROMPT);
    const drawn = plan.slice(0, -1);
    expect(new Set(drawn).size).toBe(SHOTS - 1);
    for (const p of drawn) expect(DECKS.COUPLE.prompts).toContain(p);
  });

  it('never repeats a prompt for back-to-back groups until the pool is used up', () => {
    const bag = new PromptBag(mulberry32(7));
    const first3 = [bag.draw('BESTIE'), bag.draw('BESTIE'), bag.draw('BESTIE')].flatMap((p) => p.slice(0, -1));
    expect(first3).toHaveLength(21);
    expect(new Set(first3).size).toBe(21); // 21 of 24 used, none twice
  });

  it('uses every prompt about equally over a day', () => {
    const bag = new PromptBag(mulberry32(3));
    const counts = new Map<string, number>();
    for (let s = 0; s < 48; s++) {
      for (const p of bag.draw('CHAOS').slice(0, -1)) counts.set(p, (counts.get(p) ?? 0) + 1);
    }
    expect(counts.size).toBe(24);
    for (const n of counts.values()) {
      expect(n).toBeGreaterThanOrEqual(13); // 48 × 7 / 24 = 14 each
      expect(n).toBeLessThanOrEqual(15);
    }
  });

  it('keeps no repeats inside a session when the pile is reshuffled mid-draw', () => {
    const bag = new PromptBag(mulberry32(11));
    for (let s = 0; s < 30; s++) {
      const drawn = bag.draw('KULIAH').slice(0, -1);
      expect(new Set(drawn).size).toBe(SHOTS - 1);
    }
  });

  it('keeps a separate pile per gaya', () => {
    const bag = new PromptBag(mulberry32(5));
    const corp = bag.draw('CORPORATE');
    const kuliah = bag.draw('KULIAH');
    for (const p of corp.slice(0, -1)) expect(DECKS.CORPORATE.prompts).toContain(p);
    for (const p of kuliah.slice(0, -1)) expect(DECKS.KULIAH.prompts).toContain(p);
  });

  it('runs the free gaya in order', () => {
    const bag = new PromptBag(mulberry32(2));
    expect(bag.draw('BEBAS')).toEqual([...DECKS.BEBAS.prompts]);
  });
});
