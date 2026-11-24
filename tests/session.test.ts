import { describe, expect, it, vi } from 'vitest';
import {
  MAX_RETAKES,
  OFFER_MS,
  RESULT_MS,
  RETAKE_CHOOSE_MS,
  SELECT_TIMEOUT_MS,
  SHOTS,
  STRIP_SHOTS,
} from '../src/booth/config';
import { BoothSession, type SessionDeps } from '../src/booth/session';
import { Cancelled } from '../src/booth/timing';
import type { GuestView, Phase } from '../src/shared/view';

/** Instant sleep that still honours cancellation. */
async function fastSleep(_ms: number, signal: AbortSignal): Promise<void> {
  await Promise.resolve();
  if (signal.aborted) throw new Cancelled();
}

/** Long waits (timeouts) never fire unless a test opts in, by the phase they were started in. */
function setup(overrides: Partial<SessionDeps<number>> = {}, fireIn: Phase[] = []) {
  let shotNo = 0;
  const deps: SessionDeps<number> = {
    grab: vi.fn(() => ++shotNo),
    thumb: (shot) => `thumb-${shot}`,
    deliver: vi.fn(async () => ({ link: 'https://x.test/g?s=ABC234', stripThumb: 'data:x' })),
    newCode: () => 'ABC234',
    random: () => 0.6, // → the 2nd of 3 frames in the set (Set B → 'b2')
    log: () => {},
    sleep: (ms, signal) =>
      ms >= 30_000 && !fireIn.includes(session.view.phase) ? new Promise(() => {}) : fastSleep(ms, signal),
    ...overrides,
  };
  const views: GuestView[] = [];
  const session = new BoothSession(deps, (v) => views.push(v));
  const phases = () => views.map((v) => v.phase).filter((p, i, a) => p !== a[i - 1]);
  return { deps, session, views, phases };
}

/** Attract → Set B → pose picker. */
function toDeck(session: BoothSession<number>) {
  session.begin();
  session.pickSet('B');
  session.confirmSet();
  expect(session.view.phase).toBe('deck');
}

async function toSelect(session: BoothSession<number>, deck: 'BESTIE' | 'COUPLE' = 'COUPLE') {
  toDeck(session);
  await session.chooseDeck(deck);
  expect(session.view.phase).toBe('select');
}

describe('BoothSession', () => {
  it('takes every shot, then waits on the selection screen with thumbnails', async () => {
    const { deps, session } = setup();
    await toSelect(session);
    expect(deps.grab).toHaveBeenCalledTimes(SHOTS);
    expect(session.view.thumbs).toEqual(Array.from({ length: SHOTS }, (_, i) => `thumb-${i + 1}`));
    expect(session.view.selected).toEqual([]);
    expect(session.view.flashId).toBe(SHOTS);
    expect(deps.deliver).not.toHaveBeenCalled();
  });

  it('shows a different prompt and a countdown for every shot', async () => {
    const { session, views } = setup();
    await toSelect(session, 'BESTIE');
    const counts = views.filter((v) => v.phase === 'capturing' && v.count !== null).map((v) => v.count);
    expect(counts).toEqual(Array.from({ length: SHOTS }, () => [3, 2, 1]).flat());
    const prompts = new Set(views.map((v) => v.prompt).filter(Boolean));
    expect(prompts.size).toBe(SHOTS);
  });

  it('runs a standard session: pick 4 → reveal → result', async () => {
    const { deps, session, phases } = setup();
    await toSelect(session);
    for (const i of [6, 1, 3, 4]) session.toggle(i);
    expect(session.view.selected).toEqual([1, 3, 4, 6]); // kept in shooting order
    await session.confirm();

    expect(phases()).toEqual<Phase[]>(['set', 'deck', 'capturing', 'select', 'reveal', 'offer']);
    expect(deps.deliver).toHaveBeenCalledWith({
      code: 'ABC234',
      shots: [1, 2, 3, 4, 5, 6, 7, 8],
      chosen: [1, 3, 4, 6],
      pkg: 'standard',
      frame: 'b2',
    });
    // The book offer comes before the QR, and still has the photos for its preview.
    expect(session.view).toMatchObject({ phase: 'offer', pkg: 'standard', link: null });
    expect(session.view.thumbs).toHaveLength(SHOTS);
    session.handleIntent({ type: 'nextFromOffer' }, 'BESTIE');
    expect(session.view).toMatchObject({ phase: 'result', pkg: 'standard', link: 'https://x.test/g?s=ABC234' });
    expect(session.view.thumbs).toEqual([]); // dropped once no longer needed
  });

  it('caps the pick at four and lets the guest unpick', async () => {
    const { session } = setup();
    await toSelect(session);
    for (const i of [0, 1, 2, 3, 4]) session.toggle(i);
    expect(session.view.selected).toEqual([0, 1, 2, 3]);
    session.toggle(2);
    session.toggle(7);
    expect(session.view.selected).toEqual([0, 1, 3, 7]);
    session.toggle(99);
    expect(session.view.selected).toHaveLength(STRIP_SHOTS);
  });

  it('will not continue with fewer than four photos', async () => {
    const { deps, session } = setup();
    await toSelect(session);
    session.toggle(0);
    await session.confirm();
    expect(session.view.phase).toBe('select');
    expect(deps.deliver).not.toHaveBeenCalled();
  });

  it('upgrades to the big print only after the operator confirms', async () => {
    const { deps, session } = setup();
    await toSelect(session);
    session.handleIntent({ type: 'upgrade' }, 'BESTIE');
    expect(session.view.upgradePending).toBe(true);
    session.toggle(0); // picking is frozen while waiting
    expect(session.view.selected).toEqual([]);

    await session.approveUpgrade();
    expect(deps.deliver).toHaveBeenCalledWith(
      expect.objectContaining({ pkg: 'big', chosen: [0, 1, 2, 3, 4, 5, 6, 7] }),
    );
    expect(session.view).toMatchObject({ phase: 'offer', pkg: 'big', upgradePending: false });
  });

  it('goes back to picking when the upgrade is cancelled', async () => {
    const { deps, session } = setup();
    await toSelect(session);
    session.handleIntent({ type: 'upgrade' }, 'BESTIE');
    session.handleIntent({ type: 'cancelUpgrade' }, 'BESTIE');
    expect(session.view.upgradePending).toBe(false);
    for (const i of [0, 2, 4, 6]) session.handleIntent({ type: 'toggle', index: i }, 'BESTIE');
    session.handleIntent({ type: 'confirm' }, 'BESTIE');
    await vi.waitFor(() => expect(session.view.phase).toBe('offer'));
    expect(deps.deliver).toHaveBeenCalledWith(expect.objectContaining({ pkg: 'standard', chosen: [0, 2, 4, 6] }));
  });

  it('drops an unanswered upgrade request when the selection time runs out', async () => {
    let release: (() => void) | null = null;
    const sleep = (ms: number, signal: AbortSignal) =>
      ms < 30_000
        ? fastSleep(ms, signal)
        : new Promise<void>((resolve, reject) => {
            release = resolve;
            signal.addEventListener('abort', () => reject(new Cancelled()));
          });
    const { session } = setup({ sleep });
    await toSelect(session);
    session.handleIntent({ type: 'upgrade' }, 'BESTIE');
    expect(session.view.upgradePending).toBe(true);
    (release as (() => void) | null)?.();
    await vi.waitFor(() => expect(session.view.upgradePending).toBe(false));
    expect(session.view.phase).toBe('select');
  });

  it('goes back to the start screen when a photo cannot be taken', async () => {
    const log = vi.fn();
    const { session } = setup({
      grab: vi.fn(() => {
        throw new Error('camera lost');
      }),
      log,
    });
    toDeck(session);
    await session.chooseDeck('CHAOS');
    expect(session.view.phase).toBe('idle');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('camera lost'), 'err');
  });

  it('fills the strip with the earliest photos when nobody finishes picking', async () => {
    const { deps, session } = setup({}, ['select']);
    toDeck(session);
    // The timeout fires as soon as the selection screen opens, so pick inside the same tick.
    const run = session.chooseDeck('CHAOS');
    await vi.waitFor(() => expect(deps.deliver).toHaveBeenCalled());
    await run;
    expect(deps.deliver).toHaveBeenCalledWith(expect.objectContaining({ pkg: 'standard', chosen: [0, 1, 2, 3] }));
  });

  it('cancels a capture on reset without taking photos', async () => {
    const { deps, session } = setup();
    toDeck(session);
    const run = session.chooseDeck('CHAOS');
    session.reset();
    await run;
    expect(session.view.phase).toBe('idle');
    expect(deps.grab).not.toHaveBeenCalled();
  });

  it('a reset on the selection screen drops the photos', async () => {
    const { deps, session } = setup();
    await toSelect(session);
    session.reset();
    expect(session.view.phase).toBe('idle');
    expect(session.view.thumbs).toEqual([]);
    await session.approveUpgrade();
    expect(deps.deliver).not.toHaveBeenCalled();
  });

  it('still reaches the result screen when delivery fails, with a note instead of a QR', async () => {
    const { session } = setup({ deliver: vi.fn(async () => Promise.reject(new Error('offline'))) });
    await toSelect(session);
    for (const i of [0, 1, 2, 3]) session.toggle(i);
    await session.confirm();
    session.nextFromOffer();
    expect(session.view.phase).toBe('result');
    expect(session.view.link).toBeNull();
    expect(session.view.note).toMatch(/QR/);
  });

  it('handles the start, cancel and finish taps', async () => {
    const { session } = setup();
    session.handleIntent({ type: 'start' }, 'BESTIE');
    expect(session.view.phase).toBe('set');
    session.handleIntent({ type: 'cancel' }, 'BESTIE');
    expect(session.view.phase).toBe('idle');
    // Space on the Mac: start → Set A (nothing highlighted) → default deck.
    session.quickStart('COUPLE');
    session.quickStart('COUPLE');
    expect(session.view).toMatchObject({ phase: 'deck', set: 'A' });
    session.quickStart('COUPLE');
    await vi.waitFor(() => expect(session.view.phase).toBe('select'));
    expect(session.view.deck).toBe('COUPLE');
    for (const i of [0, 1, 2, 3]) session.toggle(i);
    await session.confirm();
    session.handleIntent({ type: 'finish' }, 'BESTIE'); // ignored on the book offer
    expect(session.view.phase).toBe('offer');
    session.handleIntent({ type: 'nextFromOffer' }, 'BESTIE');
    session.handleIntent({ type: 'finish' }, 'BESTIE');
    expect(session.view.phase).toBe('idle');
  });

  /* ---------- Frame sets ---------- */

  it('opens the set picker first and only moves on once a set is chosen', () => {
    const { session } = setup();
    session.handleIntent({ type: 'start' }, 'BESTIE');
    expect(session.view).toMatchObject({ phase: 'set', set: null });
    session.handleIntent({ type: 'confirmSet' }, 'BESTIE');
    expect(session.view.phase).toBe('set');
    session.handleIntent({ type: 'set', set: 'B' }, 'BESTIE');
    session.handleIntent({ type: 'set', set: 'A' }, 'BESTIE'); // changed their mind
    expect(session.view.set).toBe('A');
    session.handleIntent({ type: 'confirmSet' }, 'BESTIE');
    expect(session.view).toMatchObject({ phase: 'deck', set: 'A' });
  });

  it('ignores unknown sets and set taps outside the set screen', () => {
    const { session } = setup();
    session.begin();
    session.handleIntent({ type: 'set', set: 'Z' as never }, 'BESTIE');
    session.handleIntent({ type: 'set', set: 'C' as never }, 'BESTIE'); // Set C was removed
    expect(session.view.set).toBeNull();
    session.pickSet('B');
    session.confirmSet();
    session.pickSet('A');
    expect(session.view).toMatchObject({ phase: 'deck', set: 'B' });
  });

  it('goes back from the pose picker to the set picker, keeping the set', () => {
    const { session } = setup();
    toDeck(session);
    session.handleIntent({ type: 'back' }, 'BESTIE');
    expect(session.view).toMatchObject({ phase: 'set', set: 'B' });
    session.handleIntent({ type: 'cancel' }, 'BESTIE');
    expect(session.view).toMatchObject({ phase: 'idle', set: null });
  });

  it.each([
    [0, 'a1'],
    [0.5, 'a3'],
    [0.999, 'a5'],
  ])('only rolls frames from the chosen set (random %s → %s)', async (r, frame) => {
    const { deps, session } = setup({ random: () => r });
    session.begin();
    session.pickSet('A');
    session.confirmSet();
    await session.chooseDeck('BESTIE');
    for (const i of [0, 1, 2, 3]) session.toggle(i);
    await session.confirm();
    expect(deps.deliver).toHaveBeenCalledWith(expect.objectContaining({ frame }));
    expect(session.view).toMatchObject({ phase: 'offer', set: 'A', frame });
  });

  /* ---------- Book keychain offer ---------- */

  /** Runs a session up to the book offer. */
  async function toOffer(session: BoothSession<number>) {
    await toSelect(session);
    for (const i of [1, 3, 5, 7]) session.toggle(i);
    await session.confirm();
  }

  it('"Next" on the book info screen goes to the QR', async () => {
    const { session } = setup();
    await toOffer(session);
    expect(session.view.offerId).toBeGreaterThan(0);

    session.handleIntent({ type: 'nextFromOffer' }, 'BESTIE');
    expect(session.view).toMatchObject({ phase: 'result', link: 'https://x.test/g?s=ABC234' });
    expect(session.view.thumbs).toEqual([]);
  });

  it('moves on to the result when the offer screen is left alone', async () => {
    const { session } = setup({}, ['offer']);
    await toOffer(session);
    await vi.waitFor(() => expect(session.view.phase).toBe('result'));
  });

  it('ignores "Next" outside the book info screen', async () => {
    const { session } = setup();
    session.handleIntent({ type: 'nextFromOffer' }, 'BESTIE');
    expect(session.view.phase).toBe('idle');
    await toSelect(session);
    session.handleIntent({ type: 'nextFromOffer' }, 'BESTIE');
    expect(session.view.phase).toBe('select');
  });

  it('keeps the screens up for the agreed times', () => {
    expect(SELECT_TIMEOUT_MS).toBe(60_000);
    expect(OFFER_MS).toBe(60_000);
    expect(RESULT_MS).toBe(90_000);
  });

  it('a reset on the book info screen drops the session', async () => {
    const { session } = setup();
    await toOffer(session);
    session.reset();
    session.nextFromOffer();
    expect(session.view.phase).toBe('idle');
  });
});

/* ---------- Retake ---------- */

/** Like setup(), but the old-or-new choice only times out when `autoChoose` is set. */
function retakeSetup(autoChoose = false, overrides: Partial<SessionDeps<number>> = {}) {
  const never = () => new Promise<void>(() => {});
  return setup({
    sleep: (ms, signal) =>
      ms === RETAKE_CHOOSE_MS ? (autoChoose ? fastSleep(ms, signal) : never()) : ms >= 30_000 ? never() : fastSleep(ms, signal),
    ...overrides,
  });
}

/** The prompt shown for each of the 8 shots. */
function promptsByShot(views: GuestView[]): string[] {
  const out: string[] = [];
  for (const v of views) if (v.phase === 'capturing' && v.retakeOf === null && v.prompt) out[v.shot] = v.prompt;
  return out;
}

describe('BoothSession retake', () => {
  it('retakes a photo with the same prompt, then uses the new one when picked', async () => {
    const { deps, session, views } = retakeSetup();
    await toSelect(session);
    const prompts = promptsByShot(views);
    for (const i of [0, 4]) session.toggle(i);
    expect(session.view.retakesLeft).toBe(MAX_RETAKES);

    const before = views.length;
    await session.retake(4);
    const during = views.slice(before).filter((v) => v.phase === 'capturing');
    expect(during.length).toBeGreaterThan(0);
    expect(during.every((v) => v.retakeOf === 4 && v.prompt === prompts[4])).toBe(true);
    expect(during.filter((v) => v.count !== null).map((v) => v.count)).toEqual([3, 2, 1]);

    expect(session.view).toMatchObject({
      phase: 'select',
      retakeOf: null,
      retakesLeft: MAX_RETAKES - 1,
      compare: { index: 4, old: 'thumb-5', fresh: 'thumb-9' },
      selected: [0, 4],
    });
    session.handleIntent({ type: 'toggle', index: 2 }, 'BESTIE'); // blocked while choosing
    expect(session.view.selected).toEqual([0, 4]);

    session.handleIntent({ type: 'keepRetake', use: 'new' }, 'BESTIE');
    expect(session.view).toMatchObject({ compare: null, freshShot: 4, selected: [0, 4] });
    expect(session.view.thumbs[4]).toBe('thumb-9');

    for (const i of [1, 2]) session.toggle(i);
    await session.confirm();
    expect(deps.deliver).toHaveBeenCalledWith(
      expect.objectContaining({ shots: [1, 2, 3, 4, 9, 6, 7, 8], chosen: [0, 1, 2, 4] }),
    );
  });

  it('keeps the old photo when the guest prefers it (the retake is still used)', async () => {
    const { deps, session } = retakeSetup();
    await toSelect(session);
    await session.retake(2);
    session.keepRetake('old');
    expect(session.view).toMatchObject({ compare: null, freshShot: null, retakesLeft: MAX_RETAKES - 1 });
    expect(session.view.thumbs[2]).toBe('thumb-3');
    for (const i of [0, 1, 2, 3]) session.toggle(i);
    await session.confirm();
    expect(deps.deliver).toHaveBeenCalledWith(expect.objectContaining({ shots: [1, 2, 3, 4, 5, 6, 7, 8] }));
  });

  it('uses the new photo when nobody picks in time', async () => {
    const { session } = retakeSetup(true);
    await toSelect(session);
    await session.retake(0);
    await vi.waitFor(() => expect(session.view.compare).toBeNull());
    expect(session.view).toMatchObject({ freshShot: 0 });
    expect(session.view.thumbs[0]).toBe('thumb-9');
  });

  it(`allows ${MAX_RETAKES} retakes, plus any the operator adds`, async () => {
    const { deps, session } = retakeSetup();
    await toSelect(session);
    for (let n = 0; n < MAX_RETAKES; n++) {
      await session.retake(n);
      session.keepRetake('new');
    }
    expect(session.view.retakesLeft).toBe(0);
    await session.retake(5);
    expect(session.view.compare).toBeNull();
    expect(deps.grab).toHaveBeenCalledTimes(SHOTS + MAX_RETAKES);

    session.grantRetake();
    expect(session.view.retakesLeft).toBe(1);
    await session.retake(5);
    expect(session.view.compare?.index).toBe(5);
  });

  it('ignores retakes outside the select screen, while upgrading, or for bad indexes', async () => {
    const { deps, session } = retakeSetup();
    await session.retake(0);
    session.grantRetake();
    expect(session.view).toMatchObject({ phase: 'idle', retakesLeft: 0 });
    await toSelect(session);
    await session.retake(-1);
    await session.retake(SHOTS);
    await session.retake(1.5);
    session.requestUpgrade();
    await session.retake(0);
    expect(deps.grab).toHaveBeenCalledTimes(SHOTS);
    expect(session.view.retakesLeft).toBe(MAX_RETAKES);
  });

  it('gives the retake back if the camera fails', async () => {
    let calls = 0;
    const { session } = retakeSetup(false, {
      grab: vi.fn(() => {
        if (++calls > SHOTS) throw new Error('camera unplugged');
        return calls;
      }),
    });
    await toSelect(session);
    await session.retake(3);
    expect(session.view).toMatchObject({ phase: 'select', retakesLeft: MAX_RETAKES, compare: null, retakeOf: null });
  });

  it('a reset during a retake drops the session', async () => {
    const { deps, session } = retakeSetup();
    await toSelect(session);
    const pending = session.retake(1);
    session.reset();
    await pending;
    session.keepRetake('new');
    expect(session.view.phase).toBe('idle');
    expect(deps.deliver).not.toHaveBeenCalled();
  });
});

/** Attract → BINUS with `photos` → pose picker → select. */
async function toBinusSelect(session: BoothSession<number>, photos: 3 | 4) {
  session.begin();
  session.handleIntent({ type: 'set', set: 'AI', photos }, 'COUPLE');
  expect(session.view.set).toBe('AI');
  expect(session.view.pickCount).toBe(photos);
  session.confirmSet();
  await session.chooseDeck('COUPLE');
  expect(session.view.phase).toBe('select');
}

describe('BoothSession BINUS set', () => {
  it('3 photos: picks exactly 3 and gets the 3-photo frame, no gacha roll', async () => {
    // random 0.6 would roll the 2nd frame of the set ('ai4') if a gacha roll happened.
    const { session, deps } = setup({ random: () => 0.6 });
    await toBinusSelect(session, 3);
    [0, 2, 5, 7].forEach((i) => session.toggle(i));
    expect(session.view.selected).toEqual([0, 2, 5]); // the 4th tap is ignored
    await session.confirm();
    expect(deps.deliver).toHaveBeenCalledWith(
      expect.objectContaining({ chosen: [0, 2, 5], frame: 'ai3', pkg: 'standard' }),
    );
    expect(session.view.frame).toBe('ai3');
  });

  it('4 photos: needs 4 and gets the 4-photo frame', async () => {
    const { session, deps } = setup();
    await toBinusSelect(session, 4);
    [1, 3, 4].forEach((i) => session.toggle(i));
    await session.confirm();
    expect(session.view.phase).toBe('select'); // 3 isn't enough
    session.toggle(6);
    await session.confirm();
    expect(deps.deliver).toHaveBeenCalledWith(expect.objectContaining({ chosen: [1, 3, 4, 6], frame: 'ai4' }));
  });

  it('switching between the 3 and 4 photo frame, and back to a gacha set, updates the count', () => {
    const { session } = setup();
    session.begin();
    session.handleIntent({ type: 'set', set: 'AI', photos: 3 }, 'COUPLE');
    expect(session.view.pickCount).toBe(3);
    session.handleIntent({ type: 'set', set: 'AI', photos: 4 }, 'COUPLE');
    expect(session.view.pickCount).toBe(4);
    session.handleIntent({ type: 'set', set: 'AI', photos: 3 }, 'COUPLE');
    session.pickSet('A');
    expect(session.view).toMatchObject({ set: 'A', pickCount: STRIP_SHOTS });
    // A bad or missing count on the BINUS set falls back to 4.
    session.handleIntent({ type: 'set', set: 'AI', photos: 7 as 3 }, 'COUPLE');
    expect(session.view.pickCount).toBe(4);
  });

  it('auto-fills up to 3 when nobody finishes picking', async () => {
    const { session, deps } = setup({}, ['select']);
    session.begin();
    session.handleIntent({ type: 'set', set: 'AI', photos: 3 }, 'COUPLE');
    session.confirmSet();
    // The timeout fires as soon as the selection screen opens.
    const run = session.chooseDeck('COUPLE');
    await vi.waitFor(() => expect(deps.deliver).toHaveBeenCalled());
    await run;
    expect(deps.deliver).toHaveBeenCalledWith(expect.objectContaining({ chosen: [0, 1, 2], frame: 'ai3' }));
  });

  it('offers no big print on the BINUS set', async () => {
    const { session } = setup();
    await toBinusSelect(session, 3);
    session.requestUpgrade();
    expect(session.view.upgradePending).toBe(false);
  });

  it('starts the next guest back at 4 photos', async () => {
    const { session } = setup();
    await toBinusSelect(session, 3);
    session.reset();
    session.begin();
    expect(session.view).toMatchObject({ set: null, pickCount: STRIP_SHOTS });
  });
});
