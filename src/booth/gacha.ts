/**
 * Gacha frames, grouped into sets. The guest picks a set, then the frame is
 * rolled from that set only. Every frame has the same weight for now; to move
 * to rarity tiers later (e.g. 60/30/10), change the weights — roll() and odds()
 * already handle any weighting.
 *
 * Set A uses the designer's finished frames (PNG art in public/frames/). Sets B
 * and C are colour-and-pattern placeholders until their designs are in.
 */
export type SetId = 'A' | 'B' | 'C';

/** Background pattern painted over the frame colour (on screen and on the print). */
export type FramePattern = 'none' | 'dots' | 'stripes' | 'check' | 'sprinkle';

export interface FrameStyle {
  id: string;
  name: string;
  set: SetId;
  weight: number;
  /** Strip background. */
  bg: string;
  /** Thin border around each photo. */
  border: string;
  /** Main text on the strip. */
  ink: string;
  /** Secondary text (date, labels). */
  dim: string;
  /** "Photobooth" wordmark and event name. */
  accent: string;
  pattern: FramePattern;
  /** Colour of the pattern marks (keep it faint so the footer stays readable). */
  patternInk: string;
  /**
   * Finished artwork from the designer. `sheet` is the full 1200×1800 print with
   * transparent photo holes (two identical strips); `thumb` is one strip for the
   * screens. Frames without art are drawn from the colours above.
   */
  art?: { sheet: string; thumb: string };
  /** Outline around the hand-lettered "with love, Dearly" on layouts the art doesn't cover. */
  outline?: string;
}

const minimal = (n: number) => ({
  sheet: `/frames/minimal/minimal-${n}.png`,
  thumb: `/frames/minimal/minimal-${n}-thumb.jpg`,
});

export interface FrameSet {
  id: SetId;
  /** Shown to guests. Final names come later; "Set A/B/C" for now. */
  label: string;
  /** Card colour on the set picker. */
  tint: string;
}

export const FRAME_SETS = [
  { id: 'A', label: 'Set A', tint: '#F6D9D6' },
  { id: 'B', label: 'Set B', tint: '#D6E2F3' },
  { id: 'C', label: 'Set C', tint: '#E9DCC4' },
] as const satisfies readonly FrameSet[];

export const FRAMES = [
  // Set A: "Minimal", the designer's finished frames
  { id: 'a1', name: 'Frame 1', set: 'A', weight: 1, bg: '#000000', border: '#000000', ink: '#FFFFFF', dim: '#BFBFBF', accent: '#FFFFFF', pattern: 'none', patternInk: 'transparent', art: minimal(1) },
  { id: 'a2', name: 'Frame 2', set: 'A', weight: 1, bg: '#FFFFFF', border: '#FFFFFF', ink: '#B6282C', dim: '#C2585C', accent: '#B6282C', pattern: 'none', patternInk: 'transparent', art: minimal(2) },
  { id: 'a3', name: 'Frame 3', set: 'A', weight: 1, bg: '#FFFFFF', border: '#FFFFFF', ink: '#5E95D6', dim: '#79ACE4', accent: '#5E95D6', pattern: 'none', patternInk: 'transparent', art: minimal(3) },
  { id: 'a4', name: 'Frame 4', set: 'A', weight: 1, bg: '#DCE6F0', border: '#DCE6F0', ink: '#FFFFFF', dim: '#3F88D8', accent: '#3F88D8', pattern: 'check', patternInk: 'rgba(63, 136, 216, 0.42)', art: minimal(4), outline: '#3F88D8' },
  { id: 'a5', name: 'Frame 5', set: 'A', weight: 1, bg: '#B6282C', border: '#B6282C', ink: '#FFFFFF', dim: '#F0C9CA', accent: '#FFFFFF', pattern: 'none', patternInk: 'transparent', art: minimal(5) },
  // Set B (placeholder): gingham blue, white stripes, navy
  { id: 'b1', name: 'Frame 6', set: 'B', weight: 1, bg: '#DCE6F5', border: '#BFD0EA', ink: '#2F4A80', dim: '#506DA5', accent: '#2F4A80', pattern: 'check', patternInk: 'rgba(84, 127, 204, 0.24)' },
  { id: 'b2', name: 'Frame 7', set: 'B', weight: 1, bg: '#F7F4EE', border: '#DCE3EE', ink: '#2F4A80', dim: '#5F78AA', accent: '#9E2A2B', pattern: 'stripes', patternInk: 'rgba(84, 127, 204, 0.15)' },
  { id: 'b3', name: 'Frame 8', set: 'B', weight: 1, bg: '#2F4A80', border: '#22385F', ink: '#F7F1E8', dim: '#B5C6E6', accent: '#F4ECB1', pattern: 'sprinkle', patternInk: 'rgba(247, 241, 232, 0.24)' },
  // Set C (placeholder): tan, mocha, sage
  { id: 'c1', name: 'Frame 9', set: 'C', weight: 1, bg: '#E4D3B5', border: '#CDB892', ink: '#6B4430', dim: '#83614A', accent: '#6B4430', pattern: 'dots', patternInk: 'rgba(107, 68, 48, 0.15)' },
  { id: 'c2', name: 'Frame 10', set: 'C', weight: 1, bg: '#6B4430', border: '#56351F', ink: '#F1E4CC', dim: '#D7B99A', accent: '#F1D98A', pattern: 'none', patternInk: 'transparent' },
  { id: 'c3', name: 'Frame 11', set: 'C', weight: 1, bg: '#AFBF95', border: '#95A77A', ink: '#3F4B2B', dim: '#55623F', accent: '#3F4B2B', pattern: 'stripes', patternInk: 'rgba(63, 75, 43, 0.14)' },
] as const satisfies readonly FrameStyle[];

export type FrameId = (typeof FRAMES)[number]['id'];

export function frameById(id: FrameId | string): FrameStyle {
  return FRAMES.find((f) => f.id === id) ?? FRAMES[0];
}

export function isSetId(value: unknown): value is SetId {
  return FRAME_SETS.some((s) => s.id === value);
}

export function setById(id: SetId): FrameSet {
  return FRAME_SETS.find((s) => s.id === id) ?? FRAME_SETS[0];
}

/** The frames a guest can get after choosing `set`. */
export function framesInSet(set: SetId): FrameStyle[] {
  return FRAMES.filter((f) => f.set === set);
}

/**
 * Weighted pick. `r` is a random number in [0, 1); passing it in keeps this
 * function pure and testable.
 */
export function roll<T extends { weight: number }>(items: readonly T[], r: number): T {
  if (items.length === 0) throw new Error('Gacha pool is empty');
  const total = items.reduce((sum, it) => sum + it.weight, 0);
  let target = r * total;
  for (const it of items) {
    if (target < it.weight) return it;
    target -= it.weight;
  }
  return items[items.length - 1];
}

/** Chance of each item as a percentage, for the published odds. */
export function odds<T extends { weight: number }>(items: readonly T[]): number[] {
  const total = items.reduce((sum, it) => sum + it.weight, 0);
  return items.map((it) => (it.weight / total) * 100);
}

/** Cryptographically random number in [0, 1). */
export function secureRandom(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
}
