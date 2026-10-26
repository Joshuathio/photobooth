import { describe, expect, it, vi } from 'vitest';
import { OFFER_MS, RESULT_MS, SELECT_TIMEOUT_MS, SHOTS, STRIP_SHOTS } from '../src/booth/config';
import { BoothSession, type SessionDeps } from '../src/booth/session';
import { Cancelled } from '../src/booth/timing';
import type { GuestView, Phase } from '../src/shared/view';

/** Instant sleep that still honours cancellation. */
async function fastSleep(_ms: number, signal: AbortSignal): Promise<void> {
  await Promise.resolve();
  if (signal.aborted) throw new Cancelled();
}

/** Long waits (timeouts) never fire unless a test opts in. */
function setup(overrides: Partial<SessionDeps<number>> = {}, fireTimeouts: number[] = []) {
  let shotNo = 0;
  const deps: SessionDeps<number> = {
    grab: vi.fn(() => ++shotNo),
    thumb: (shot) => `thumb-${shot}`,
    deliver: vi.fn(async () => ({ link: 'https://x.test/g?s=ABC234', stripThumb: 'data:x' })),
    deliverBook: vi.fn(async () => {}),
    newCode: () => 'ABC234',
    random: () => 0.6, // → the 2nd of 3 frames in the set (Set B → 'f5')
    log: () => {},
    sleep: (ms, signal) =>
      ms >= 30_000 && !fireTimeouts.includes(ms) ? new Promise(() => {}) : fastSleep(ms, signal),
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
      frame: 'f5',
    });
    // The book offer comes before the QR, and still has the photos for its preview.
    expect(session.view).toMatchObject({ phase: 'offer', pkg: 'standard', link: null, bookPending: false });
    expect(session.view.thumbs).toHaveLength(SHOTS);
    session.handleIntent({ type: 'skipBook' }, 'BESTIE');
    expect(session.view).toMatchObject({ phase: 'result', pkg: 'standard', link: 'https://x.test/g?s=ABC234', book: false });
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

  it('fills the strip with the earliest photos when nobody finishes picking', async () => {
    const { deps, session } = setup({}, [SELECT_TIMEOUT_MS]);
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
    session.skipBook();
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
    session.handleIntent({ type: 'skipBook' }, 'BESTIE');
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
    session.handleIntent({ type: 'set', set: 'C' }, 'BESTIE');
    session.handleIntent({ type: 'set', set: 'A' }, 'BESTIE'); // changed their mind
    expect(session.view.set).toBe('A');
    session.handleIntent({ type: 'confirmSet' }, 'BESTIE');
    expect(session.view).toMatchObject({ phase: 'deck', set: 'A' });
  });

  it('ignores unknown sets and set taps outside the set screen', () => {
    const { session } = setup();
    session.begin();
    session.handleIntent({ type: 'set', set: 'Z' as never }, 'BESTIE');
    expect(session.view.set).toBeNull();
    session.pickSet('B');
    session.confirmSet();
    session.pickSet('C');
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
    [0, 'f7'],
    [0.5, 'f8'],
    [0.999, 'f9'],
  ])('only rolls frames from the chosen set (random %s → %s)', async (r, frame) => {
    const { deps, session } = setup({ random: () => r });
    session.begin();
    session.pickSet('C');
    session.confirmSet();
    await session.chooseDeck('BESTIE');
    for (const i of [0, 1, 2, 3]) session.toggle(i);
    await session.confirm();
    expect(deps.deliver).toHaveBeenCalledWith(expect.objectContaining({ frame }));
    expect(session.view).toMatchObject({ phase: 'offer', set: 'C', frame });
  });

  /* ---------- Book keychain offer ---------- */

  /** Runs a session up to the book offer. */
  async function toOffer(session: BoothSession<number>) {
    await toSelect(session);
    for (const i of [1, 3, 5, 7]) session.toggle(i);
    await session.confirm();
  }

  it('sells the book: guest taps "Mau", cashier confirms, the book file is made', async () => {
    const { deps, session } = setup();
    await toOffer(session);
    const offerId = session.view.offerId;
    expect(offerId).toBeGreaterThan(0);

    session.handleIntent({ type: 'buyBook' }, 'BESTIE');
    expect(session.view).toMatchObject({ phase: 'offer', bookPending: true });
    session.approveBook();

    expect(deps.deliverBook).toHaveBeenCalledWith({ code: 'ABC234', shots: [1, 2, 3, 4, 5, 6, 7, 8], frame: 'f5' });
    expect(session.view).toMatchObject({ phase: 'result', book: true, bookPending: false, link: 'https://x.test/g?s=ABC234' });
  });

  it('lets the cashier add the book without the guest tapping first', async () => {
    const { deps, session } = setup();
    await toOffer(session);
    session.approveBook();
    expect(deps.deliverBook).toHaveBeenCalledTimes(1);
    expect(session.view).toMatchObject({ phase: 'result', book: true });
  });

  it('skips the book when the guest changes their mind or the cashier declines', async () => {
    const a = setup();
    await toOffer(a.session);
    a.session.declineBook(); // nothing to decline yet
    expect(a.session.view.phase).toBe('offer');
    a.session.requestBook();
    a.session.handleIntent({ type: 'skipBook' }, 'BESTIE'); // "Nggak jadi"
    expect(a.session.view).toMatchObject({ phase: 'result', book: false });

    const b = setup();
    await toOffer(b.session);
    b.session.requestBook();
    b.session.declineBook();
    expect(b.session.view).toMatchObject({ phase: 'result', book: false });
    expect(a.deps.deliverBook).not.toHaveBeenCalled();
    expect(b.deps.deliverBook).not.toHaveBeenCalled();
  });

  it('moves on to the result when the 30 s offer runs out, but not while the cashier is checking', async () => {
    /** The offer timer only runs out when the test says so (and only if it wasn't cancelled). */
    function withOfferClock() {
      let runOut!: () => void;
      const gate = new Promise<void>((r) => (runOut = r));
      const t = setup({
        sleep: (ms, signal) => {
          if (ms === OFFER_MS) {
            return gate.then(() => {
              if (signal.aborted) throw new Cancelled();
            });
          }
          return ms >= 30_000 ? new Promise(() => {}) : fastSleep(ms, signal);
        },
      });
      return { ...t, runOut };
    }

    const idle = withOfferClock();
    await toOffer(idle.session);
    idle.runOut();
    await vi.waitFor(() => expect(idle.session.view.phase).toBe('result'));

    const held = withOfferClock();
    await toOffer(held.session);
    held.session.requestBook();
    held.runOut();
    await new Promise((r) => setTimeout(r, 0));
    expect(held.session.view).toMatchObject({ phase: 'offer', bookPending: true });
  });

  it('ignores book taps outside the offer', async () => {
    const { deps, session } = setup();
    session.handleIntent({ type: 'buyBook' }, 'BESTIE');
    session.approveBook();
    expect(session.view.phase).toBe('idle');
    await toSelect(session);
    session.handleIntent({ type: 'buyBook' }, 'BESTIE');
    expect(session.view.bookPending).toBe(false);
    expect(deps.deliverBook).not.toHaveBeenCalled();
  });

  it('keeps the result screen up for 45 s', () => {
    expect(OFFER_MS).toBe(30_000);
    expect(RESULT_MS).toBe(45_000);
  });

  it('a reset on the book offer drops the session', async () => {
    const { deps, session } = setup();
    await toOffer(session);
    session.reset();
    session.approveBook();
    expect(session.view.phase).toBe('idle');
    expect(deps.deliverBook).not.toHaveBeenCalled();
  });
});
