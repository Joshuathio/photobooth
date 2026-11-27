/**
 * The frames guests choose from. There is no gacha any more: the guest taps the
 * frame they like before the photos are taken. `roll()` and `odds()` stay for
 * the day a random pick (with rarity weights) comes back.
 *
 * The designer's finished frames live in public/frames/ (PNG art with
 * transparent photo holes). To add a frame, add its files there and an entry to
 * FRAMES below.
 */

/** Background pattern painted over the frame colour (on screen and on the print). */
export type FramePattern = 'none' | 'dots' | 'stripes' | 'check' | 'sprinkle';

export interface FrameStyle {
  id: string;
  name: string;
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

const art = (dir: string, n: number) => ({
  sheet: `/frames/${dir}/${dir}-${n}.png`,
  thumb: `/frames/${dir}/${dir}-${n}-thumb.jpg`,
});
const minimal = (n: number) => art('minimal', n);

export const FRAMES = [
  // The designer's finished "Minimal" frames
  { id: 'a1', name: 'Frame 1', weight: 1, bg: '#000000', border: '#000000', ink: '#FFFFFF', dim: '#BFBFBF', accent: '#FFFFFF', pattern: 'none', patternInk: 'transparent', art: minimal(1) },
  { id: 'a2', name: 'Frame 2', weight: 1, bg: '#FFFFFF', border: '#FFFFFF', ink: '#B6282C', dim: '#C2585C', accent: '#B6282C', pattern: 'none', patternInk: 'transparent', art: minimal(2) },
  { id: 'a3', name: 'Frame 3', weight: 1, bg: '#FFFFFF', border: '#FFFFFF', ink: '#5E95D6', dim: '#79ACE4', accent: '#5E95D6', pattern: 'none', patternInk: 'transparent', art: minimal(3) },
  { id: 'a4', name: 'Frame 4', weight: 1, bg: '#DCE6F0', border: '#DCE6F0', ink: '#FFFFFF', dim: '#3F88D8', accent: '#3F88D8', pattern: 'check', patternInk: 'rgba(63, 136, 216, 0.42)', art: minimal(4), outline: '#3F88D8' },
  { id: 'a5', name: 'Frame 5', weight: 1, bg: '#B6282C', border: '#B6282C', ink: '#FFFFFF', dim: '#F0C9CA', accent: '#FFFFFF', pattern: 'none', patternInk: 'transparent', art: minimal(5) },
] as const satisfies readonly FrameStyle[];

export type FrameId = (typeof FRAMES)[number]['id'];

export function frameById(id: FrameId | string): FrameStyle {
  return FRAMES.find((f) => f.id === id) ?? FRAMES[0];
}

export function isFrameId(value: unknown): value is FrameId {
  return FRAMES.some((f) => f.id === value);
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
