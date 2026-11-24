/**
 * Gacha frames, grouped into sets. The guest picks a set, then the frame is
 * rolled from that set only. Every frame has the same weight for now; to move
 * to rarity tiers later (e.g. 60/30/10), change the weights — roll() and odds()
 * already handle any weighting.
 *
 * Both sets use the designer's finished frames (PNG art in public/frames/):
 * Set A "Minimal" and Set B "Bifest". To add a set, add its id to SetId, an entry
 * to FRAME_SETS and its frames below.
 */
export type SetId = 'A' | 'B' | 'AI';

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
  /** Photos on this frame. Gacha frames hold 4; the BINUS frames come as 3 or 4. */
  photos?: 3 | 4;
  /**
   * Whole-sheet art (printed uncut): photo i fills row i in both columns.
   * Edges in sheet px, [start, end], measured from the PNG's transparent holes.
   */
  grid?: { cols: readonly (readonly [number, number])[]; rows: readonly (readonly [number, number])[] };
}

const art = (set: string, n: number) => ({
  sheet: `/frames/${set}/${set}-${n}.png`,
  thumb: `/frames/${set}/${set}-${n}-thumb.jpg`,
});
const minimal = (n: number) => art('minimal', n);
const bifest = (n: number) => art('bifest', n);
const binus = (n: number) => art('binus', n);

export interface FrameSet {
  id: SetId;
  /** Shown to guests. Final names come later; "Set A/B/C" for now. */
  label: string;
  /** Card colour on the set picker. */
  tint: string;
  /** No gacha: the guest picks the frame (by photo count) themselves. */
  fixed?: boolean;
}

export const FRAME_SETS: readonly FrameSet[] = [
  { id: 'A', label: 'Set A', tint: '#F6D9D6' },
  { id: 'B', label: 'Set B', tint: '#D6E2F3' },
  // The campus collab: required at BINUS events, so it's always there to pick, never a surprise.
  { id: 'AI', label: 'BINUS × Academic Integrity', tint: '#C8222A', fixed: true },
];

/** Sets that roll a surprise frame. */
export const GACHA_SETS = FRAME_SETS.filter((s) => !s.fixed);

export const FRAMES = [
  // Set A: "Minimal", the designer's finished frames
  { id: 'a1', name: 'Frame 1', set: 'A', weight: 1, bg: '#000000', border: '#000000', ink: '#FFFFFF', dim: '#BFBFBF', accent: '#FFFFFF', pattern: 'none', patternInk: 'transparent', art: minimal(1) },
  { id: 'a2', name: 'Frame 2', set: 'A', weight: 1, bg: '#FFFFFF', border: '#FFFFFF', ink: '#B6282C', dim: '#C2585C', accent: '#B6282C', pattern: 'none', patternInk: 'transparent', art: minimal(2) },
  { id: 'a3', name: 'Frame 3', set: 'A', weight: 1, bg: '#FFFFFF', border: '#FFFFFF', ink: '#5E95D6', dim: '#79ACE4', accent: '#5E95D6', pattern: 'none', patternInk: 'transparent', art: minimal(3) },
  { id: 'a4', name: 'Frame 4', set: 'A', weight: 1, bg: '#DCE6F0', border: '#DCE6F0', ink: '#FFFFFF', dim: '#3F88D8', accent: '#3F88D8', pattern: 'check', patternInk: 'rgba(63, 136, 216, 0.42)', art: minimal(4), outline: '#3F88D8' },
  { id: 'a5', name: 'Frame 5', set: 'A', weight: 1, bg: '#B6282C', border: '#B6282C', ink: '#FFFFFF', dim: '#F0C9CA', accent: '#FFFFFF', pattern: 'none', patternInk: 'transparent', art: minimal(5) },
  // Set B: "Bifest", the designer's BINUS Festival frames (cloud-shaped photo holes)
  { id: 'b1', name: 'Frame 6', set: 'B', weight: 1, bg: '#FFFFFF', border: '#FFFFFF', ink: '#B6282C', dim: '#C2585C', accent: '#B6282C', pattern: 'none', patternInk: 'transparent', art: bifest(1) },
  { id: 'b2', name: 'Frame 7', set: 'B', weight: 1, bg: '#FFFFFF', border: '#FFFFFF', ink: '#5E95D6', dim: '#92BCE9', accent: '#5E95D6', pattern: 'none', patternInk: 'transparent', art: bifest(2) },
  { id: 'b3', name: 'Frame 8', set: 'B', weight: 1, bg: '#B6282C', border: '#B6282C', ink: '#FFFFFF', dim: '#F0C9CA', accent: '#FFFFFF', pattern: 'none', patternInk: 'transparent', art: bifest(3) },
  // BINUS × Academic Integrity ("NYONTEK ☞ DO"): whole 4R sheets, printed uncut so the banner stays whole
  { id: 'ai3', name: '3 photos', set: 'AI', weight: 1, bg: '#D21F2A', border: '#D21F2A', ink: '#FFFFFF', dim: '#F0C9CA', accent: '#FFFFFF', pattern: 'none', patternInk: 'transparent', art: binus(3), photos: 3,
    grid: { cols: [[63, 583], [616, 1136]], rows: [[237, 623], [843, 1227], [1266, 1651]] } },
  { id: 'ai4', name: '4 photos', set: 'AI', weight: 1, bg: '#D21F2A', border: '#D21F2A', ink: '#FFFFFF', dim: '#F0C9CA', accent: '#FFFFFF', pattern: 'none', patternInk: 'transparent', art: binus(4), photos: 4,
    grid: { cols: [[63, 584], [617, 1138]], rows: [[422, 725], [748, 1051], [1074, 1377], [1400, 1703]] } },
] as const satisfies readonly FrameStyle[];

export type FrameId = (typeof FRAMES)[number]['id'];

/** The BINUS frame for a photo count. */
export function fixedFrame(set: SetId, photos: number): FrameStyle {
  const frames = framesInSet(set);
  return frames.find((f) => f.photos === photos) ?? frames[0];
}

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
