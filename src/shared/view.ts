import { DECKS, SHOTS, STRIP_SHOTS, type DeckId } from '../booth/config';
import type { FrameId, SetId } from '../booth/gacha';

/**
 * Everything the guest screen needs to draw itself. The Mac sends this to the
 * tablet on every change, and renders the same thing in its tablet mirror.
 */
export type Phase = 'idle' | 'set' | 'deck' | 'capturing' | 'select' | 'reveal' | 'offer' | 'result';

/** Standard: 4 chosen photos on a strip (printed twice, cut). Big: all 8 on one uncut sheet. */
export type PrintPackage = 'standard' | 'big';

export interface GuestView {
  phase: Phase;
  /** Frame set the guest picked (highlighted on the set screen, then fixed for the session). */
  set: SetId | null;
  deck: DeckId | null;
  /** Index of the current shot (0-based) while capturing. */
  shot: number;
  totalShots: number;
  prompt: string | null;
  /** Countdown number, or null between countdowns. */
  count: number | null;
  /** Increments on every shot so screens can replay the flash. */
  flashId: number;
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
  pkg: PrintPackage;
  /** Guest asked for the big print; waiting for the operator to confirm payment. */
  upgradePending: boolean;
  /** Guest wants the book keychain; waiting for the operator to confirm payment. */
  bookPending: boolean;
  /** The book keychain was paid for in this session. */
  book: boolean;
  /** Bumps each time the book offer opens, so screens restart their 30 s countdown. */
  offerId: number;
  /** True when the operator is previewing a screen with sample data. */
  preview: boolean;
}

export const IDLE_VIEW: GuestView = {
  phase: 'idle',
  set: null,
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
  pkg: 'standard',
  upgradePending: false,
  bookPending: false,
  book: false,
  offerId: 0,
  preview: false,
};

export const PHASE_LABELS: Record<Phase, string> = {
  idle: 'Layar awal',
  set: 'Pilih set',
  deck: 'Pilih gaya',
  capturing: 'Foto',
  select: 'Pilih foto',
  reveal: 'Gacha',
  offer: 'Buku',
  result: 'Hasil + QR',
};

/** Sample data so every screen can be previewed without running a session. */
export function sampleView(phase: Phase): GuestView {
  const deck: DeckId = 'BESTIE';
  return {
    ...IDLE_VIEW,
    phase,
    preview: true,
    set: phase === 'idle' ? null : 'B',
    deck: phase === 'idle' || phase === 'set' ? null : deck,
    shot: phase === 'capturing' ? 1 : 0,
    prompt: phase === 'capturing' ? DECKS[deck].prompts[1] : null,
    count: phase === 'capturing' ? 3 : null,
    frame: phase === 'reveal' || phase === 'offer' || phase === 'result' ? 'f5' : null,
    code: phase === 'offer' || phase === 'result' ? 'K7XP2Q' : null,
    selected: phase === 'select' ? [0, 2, 5] : phase === 'offer' ? [0, 2, 5, 7] : [],
    offerId: phase === 'offer' ? Date.now() : 0,
    link: phase === 'result' ? 'https://example.com/gallery.html?s=K7XP2Q' : null,
  };
}
