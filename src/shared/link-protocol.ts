import type { DeckId } from '../booth/config';
import type { SetId } from '../booth/gacha';
import type { GuestView } from './view';

/** WebSocket path on the dev server that connects the Mac and the tablet. */
export const LINK_PATH = '/booth-link';

/**
 * "preview" is the tablet's second socket, opened by the worker that draws the
 * camera picture: it only receives frames and sends frame acks.
 */
export type Role = 'host' | 'guest' | 'preview';

/** Taps on the guest screen, sent to the Mac. */
export type GuestIntent =
  | { type: 'start' }
  /** Highlight a frame set on the set screen. */
  /** `photos` picks the 3- or 4-photo frame of a set with no gacha (BINUS). */
  | { type: 'set'; set: SetId; photos?: 3 | 4 }
  /** Use the highlighted set and go on to the pose picker. */
  | { type: 'confirmSet' }
  | { type: 'deck'; deck: DeckId }
  /** From the pose picker back to the set screen. */
  | { type: 'back' }
  | { type: 'cancel' }
  /** Pick or unpick a photo on the selection screen. */
  | { type: 'toggle'; index: number }
  /** Retake one photo (same prompt). Uses one of the session's retakes. */
  | { type: 'retake'; index: number }
  /** After a retake: keep the old photo or use the new one. */
  | { type: 'keepRetake'; use: 'old' | 'new' }
  /** Done picking: print the strip. */
  | { type: 'confirm' }
  /** Wants the big print with all photos (operator confirms payment). */
  | { type: 'upgrade' }
  /** Changed their mind about the big print. */
  | { type: 'cancelUpgrade' }
  /** "Next" on the book info screen: on to the QR. */
  | { type: 'nextFromOffer' }
  | { type: 'finish' };

export type LinkMessage =
  /** Mac → tablet: what to show. */
  | { type: 'state'; view: GuestView }
  /** Tablet → Mac: what the guest tapped. */
  | { type: 'intent'; intent: GuestIntent }
  /** Tablet → Mac, on every (re)connect: please send me the current screen. */
  | { type: 'hello' }
  /** Tablet → Mac: a camera preview frame is on screen, send the next one. */
  | { type: 'frameAck' }
  /**
   * Hub → everyone: who is connected. Also repeated every few seconds as a heartbeat.
   * `active` (consoles only): whether this console is the one the tablet follows —
   * the most recently opened one.
   */
  | { type: 'peers'; hosts: number; guests: number; active?: boolean };

/** The hub sends a heartbeat this often; a link silent for STALE_MS is treated as dead. */
export const HEARTBEAT_MS = 3_000;
export const STALE_MS = 10_000;

// Live preview frames travel as binary messages (JPEG blobs) from the Mac to the tablet.
