import { DECKS, MAX_RETAKES, RESULT_MS, SELECT_TIMEOUT_MS, SHOTS, STRIP_SHOTS, type DeckId } from '../booth/config';
import type { FrameId } from '../booth/gacha';

/**
 * Everything the guest screen needs to draw itself. The Mac sends this to the
 * tablet on every change, and renders the same thing in its tablet mirror.
 */
export type Phase = 'idle' | 'frame' | 'deck' | 'capturing' | 'select' | 'reveal' | 'result';


export interface GuestView {
  phase: Phase;
  deck: DeckId | null;
  /** Index of the current shot (0-based) while capturing. */
  shot: number;
  totalShots: number;
  prompt: string | null;
  /** Countdown number, or null between countdowns. */
  count: number | null;
  /** Increments on every shot so screens can replay the flash. */
  flashId: number;
  /** The frame the guest picked (highlighted on the frame screen, then fixed for the session). */
  frame: FrameId | null;
  code: string | null;
  /** Gallery link for the QR code. */
  link: string | null;
  /** Small JPEG data URL of the finished strip. */
  stripThumb: string | null;
  /** True while the strip is still being built and uploaded. */
  busy: boolean;
  /** Short note for the guest, e.g. when the QR isn't available. */
  note: string | null;
  /** Small JPEG data URLs of every shot, sent only while the guest is choosing. */
  thumbs: string[];
  /** Indexes of the shots chosen for the strip, in the order they were taken. */
  selected: number[];
  /** How many photos go on the strip. */
  pickCount: number;
  /** Retakes the guest still has this session. */
  retakesLeft: number;
  /** While capturing: the shot being retaken, or null during the normal 8 shots. */
  retakeOf: number | null;
  /** The shot just replaced by a retake, highlighted on the select screen. */
  freshShot: number | null;
  /** Length of the countdown shown on this screen, or null when there is none. */
  timerMs: number | null;
  /** Bumps each time that countdown restarts. */
  timerId: number;
  /** True when the operator is previewing a screen with sample data. */
  preview: boolean;
}

export const IDLE_VIEW: GuestView = {
  phase: 'idle',
  deck: null,
  shot: 0,
  totalShots: SHOTS,
  prompt: null,
  count: null,
  flashId: 0,
  frame: null,
  code: null,
  link: null,
  stripThumb: null,
  busy: false,
  note: null,
  thumbs: [],
  selected: [],
  pickCount: STRIP_SHOTS,
  retakesLeft: 0,
  retakeOf: null,
  freshShot: null,
  timerMs: null,
  timerId: 0,
  preview: false,
};

export const PHASE_LABELS: Record<Phase, string> = {
  idle: 'Layar awal',
  frame: 'Pilih frame',
  deck: 'Pilih gaya',
  capturing: 'Foto',
  select: 'Pilih foto',
  reveal: 'Menyiapkan',
  result: 'Hasil + QR',
};

/** Sample data so every screen can be previewed without running a session. */
export function sampleView(phase: Phase): GuestView {
  const deck: DeckId = 'BESTIE';
  return {
    ...IDLE_VIEW,
    phase,
    preview: true,
    deck: phase === 'idle' || phase === 'frame' || phase === 'deck' ? null : deck,
    shot: phase === 'capturing' ? 1 : 0,
    prompt: phase === 'capturing' ? DECKS[deck].prompts[1] : null,
    count: phase === 'capturing' ? 3 : null,
    frame: phase === 'idle' || phase === 'frame' ? null : 'a4',
    code: phase === 'result' ? 'K7XP2Q' : null,
    selected: phase === 'select' ? [0, 2, 5] : [],
    retakesLeft: phase === 'select' ? MAX_RETAKES : 0,
    timerMs: phase === 'select' ? SELECT_TIMEOUT_MS : phase === 'result' ? RESULT_MS : null,
    link: phase === 'result' ? 'https://example.com/gallery.html?s=K7XP2Q' : null,
  };
}
