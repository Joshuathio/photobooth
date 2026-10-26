import type { DeckId } from '../booth/config';
import type { SetId } from '../booth/gacha';
import type { GuestView } from './view';

/** WebSocket path on the dev server that connects the Mac and the tablet. */
export const LINK_PATH = '/booth-link';

export type Role = 'host' | 'guest';

/** Taps on the guest screen, sent to the Mac. */
export type GuestIntent =
  | { type: 'start' }
  /** Highlight a frame set on the set screen. */
  | { type: 'set'; set: SetId }
  /** Use the highlighted set and go on to the pose picker. */
  | { type: 'confirmSet' }
  | { type: 'deck'; deck: DeckId }
  /** From the pose picker back to the set screen. */
  | { type: 'back' }
  | { type: 'cancel' }
  /** Pick or unpick a photo on the selection screen. */
  | { type: 'toggle'; index: number }
  /** Done picking: print the strip. */
  | { type: 'confirm' }
  /** Wants the big print with all photos (operator confirms payment). */
  | { type: 'upgrade' }
  /** Changed their mind about the big print. */
  | { type: 'cancelUpgrade' }
  /** Wants the book keychain: its file is saved for printing, then on to the QR. */
  | { type: 'buyBook' }
  /** "Nggak dulu" on the book offer. */
  | { type: 'skipBook' }
  | { type: 'finish' };

export type LinkMessage =
  /** Mac → tablet: what to show. */
  | { type: 'state'; view: GuestView }
  /** Tablet → Mac: what the guest tapped. */
  | { type: 'intent'; intent: GuestIntent }
  /** Hub → everyone: who is connected. */
  | { type: 'peers'; hosts: number; guests: number };

// Live preview frames travel as binary messages (JPEG blobs) from the Mac to the tablet.
