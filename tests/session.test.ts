import { describe, expect, it, vi } from 'vitest';
import {
  MAX_RETAKES,
  RESULT_MS,
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
    random: () => 0.6, // only deals the pose prompts now; frames are picked by the guest
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

/** Attract → Frame 2 → pose picker. */
function toDeck(session: BoothSession<number>) {
  session.begin();
  session.pickFrame('a2');
  session.confirmFrame();
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

  it('runs a standard session: pick 4 → reveal → result (no book offer)', async () => {
    const { deps, session, phases } = setup();
    await toSelect(session);
    for (const i of [6, 1, 3, 4]) session.toggle(i);
    expect(session.view.selected).toEqual([1, 3, 4, 6]); // kept in shooting order
    await session.confirm();

    expect(phases()).toEqual<Phase[]>(['frame', 'deck', 'capturing', 'select', 'reveal', 'result']);
    expect(deps.deliver).toHaveBeenCalledWith({
      code: 'ABC234',
      shots: [1, 2, 3, 4, 5, 6, 7, 8],
      chosen: [1, 3, 4, 6],
      frame: 'a2', // the frame the guest picked, no roll
    });
    expect(session.view).toMatchObject({ phase: 'result', frame: 'a2', link: 'https://x.test/g?s=ABC234' });
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

  it('goes back to the start screen when a photo cannot be taken', async () => {
    const log = vi.fn();
    const { session } = setup({
      grab: vi.fn(() => {
        throw new Error('camera lost');
      }),
      log,
    });
    toDeck(session);
    await session.chooseDeck('BESTIE');
    expect(session.view.phase).toBe('idle');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('camera lost'), 'err');
  });

  it('fills the strip with the earliest photos when nobody finishes picking', async () => {
    const { deps, session } = setup({}, ['select']);
    toDeck(session);
    // The timeout fires as soon as the selection screen opens, so pick inside the same tick.
    const run = session.chooseDeck('BESTIE');
    await vi.waitFor(() => expect(deps.deliver).toHaveBeenCalled());
    await run;
    expect(deps.deliver).toHaveBeenCalledWith(expect.objectContaining({ chosen: [0, 1, 2, 3] }));
  });

  it('cancels a capture on reset without taking photos', async () => {
    const { deps, session } = setup();
    toDeck(session);
    const run = session.chooseDeck('BESTIE');
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
    await session.confirm();
    expect(deps.deliver).not.toHaveBeenCalled();
  });

  it('still reaches the result screen when delivery fails, with a note instead of a QR', async () => {
    const { session } = setup({ deliver: vi.fn(async () => Promise.reject(new Error('offline'))) });
    await toSelect(session);
    for (const i of [0, 1, 2, 3]) session.toggle(i);
    await session.confirm();
    expect(session.view.phase).toBe('result');
    expect(session.view.link).toBeNull();
    expect(session.view.note).toMatch(/QR/);
  });

  it('handles the start, cancel and finish taps', async () => {
    const { session } = setup();
    session.handleIntent({ type: 'start' }, 'BESTIE');
    expect(session.view.phase).toBe('frame');
    session.handleIntent({ type: 'cancel' }, 'BESTIE');
    expect(session.view.phase).toBe('idle');
    // Space on the Mac: start → Frame 1 (nothing highlighted) → default deck.
    session.quickStart('COUPLE');
    session.quickStart('COUPLE');
    expect(session.view).toMatchObject({ phase: 'deck', frame: 'a1' });
    session.quickStart('COUPLE');
    await vi.waitFor(() => expect(session.view.phase).toBe('select'));
    expect(session.view.deck).toBe('COUPLE');
    for (const i of [0, 1, 2, 3]) session.toggle(i);
    await session.confirm();
    expect(session.view).toMatchObject({ phase: 'result', frame: 'a1' });
    session.handleIntent({ type: 'finish' }, 'BESTIE');
    expect(session.view.phase).toBe('idle');
  });

  /* ---------- Frame picker ---------- */

  it('opens the frame picker first and only moves on once a frame is chosen', () => {
    const { session } = setup();
    session.handleIntent({ type: 'start' }, 'BESTIE');
    expect(session.view).toMatchObject({ phase: 'frame', frame: null });
    session.handleIntent({ type: 'confirmFrame' }, 'BESTIE');
    expect(session.view.phase).toBe('frame');
    session.handleIntent({ type: 'frame', frame: 'a5' }, 'BESTIE');
    session.handleIntent({ type: 'frame', frame: 'a3' }, 'BESTIE'); // changed their mind
    expect(session.view.frame).toBe('a3');
    session.handleIntent({ type: 'confirmFrame' }, 'BESTIE');
    expect(session.view).toMatchObject({ phase: 'deck', frame: 'a3' });
  });

  it('ignores unknown frames (the removed Bifest and BINUS ones too) and taps outside the frame screen', () => {
    const { session } = setup();
    session.begin();
    for (const id of ['Z', 'b1', 'ai3']) session.handleIntent({ type: 'frame', frame: id as never }, 'BESTIE');
    expect(session.view.frame).toBeNull();
    session.pickFrame('a4');
    session.confirmFrame();
    session.pickFrame('a1');
    expect(session.view).toMatchObject({ phase: 'deck', frame: 'a4' });
  });

  it('goes back from the pose picker to the frame picker, keeping the frame', () => {
    const { session } = setup();
    toDeck(session);
    session.handleIntent({ type: 'back' }, 'BESTIE');
    expect(session.view).toMatchObject({ phase: 'frame', frame: 'a2' });
    session.handleIntent({ type: 'cancel' }, 'BESTIE');
    expect(session.view).toMatchObject({ phase: 'idle', frame: null });
  });

  it.each(['a1', 'a3', 'a5'] as const)('prints with the frame the guest picked (%s), whatever the random number', async (frame) => {
    const { deps, session } = setup({ random: () => 0.999 });
    session.begin();
    session.pickFrame(frame);
    session.confirmFrame();
    await session.chooseDeck('BESTIE');
    expect(session.view).toMatchObject({ phase: 'select', frame });
    for (const i of [0, 1, 2, 3]) session.toggle(i);
    await session.confirm();
    expect(deps.deliver).toHaveBeenCalledWith(expect.objectContaining({ frame }));
    expect(session.view).toMatchObject({ phase: 'result', frame });
  });

  it('starts the next guest with no frame chosen', async () => {
    const { session } = setup();
    await toSelect(session);
    session.reset();
    session.begin();
    expect(session.view).toMatchObject({ phase: 'frame', frame: null, pickCount: STRIP_SHOTS });
  });

  it('keeps the screens up for the agreed times, with two retakes per guest', () => {
    expect(SELECT_TIMEOUT_MS).toBe(60_000);
    expect(RESULT_MS).toBe(90_000);
    expect(MAX_RETAKES).toBe(2);
  });
});

/* ---------- Retake ---------- */

/** Like setup(), but long waits (select, result) never fire on their own. */
function retakeSetup(overrides: Partial<SessionDeps<number>> = {}) {
  const never = () => new Promise<void>(() => {});
  return setup({
    sleep: (ms, signal) => (ms >= 30_000 ? never() : fastSleep(ms, signal)),
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
      freshShot: 4,
      selected: [0, 4],
    });
    expect(session.view.thumbs[4]).toBe('thumb-9');

    for (const i of [1, 2]) session.toggle(i);
    await session.confirm();
    expect(deps.deliver).toHaveBeenCalledWith(
      expect.objectContaining({ shots: [1, 2, 3, 4, 9, 6, 7, 8], chosen: [0, 1, 2, 4] }),
    );
  });

  it(`allows ${MAX_RETAKES} retakes, plus any the operator adds`, async () => {
    const { deps, session } = retakeSetup();
    await toSelect(session);
    for (let n = 0; n < MAX_RETAKES; n++) {
      await session.retake(n);
    }
    expect(session.view.retakesLeft).toBe(0);
    await session.retake(5);
    expect(deps.grab).toHaveBeenCalledTimes(SHOTS + MAX_RETAKES);

    session.grantRetake();
    expect(session.view.retakesLeft).toBe(1);
    await session.retake(5);
    expect(deps.grab).toHaveBeenCalledTimes(SHOTS + MAX_RETAKES + 1);
    expect(session.view.retakesLeft).toBe(0);
  });

  it('ignores retakes outside the select screen or for bad indexes', async () => {
    const { deps, session } = retakeSetup();
    await session.retake(0);
    session.grantRetake();
    expect(session.view).toMatchObject({ phase: 'idle', retakesLeft: 0 });
    await toSelect(session);
    await session.retake(-1);
    await session.retake(SHOTS);
    await session.retake(1.5);
    expect(deps.grab).toHaveBeenCalledTimes(SHOTS);
    expect(session.view.retakesLeft).toBe(MAX_RETAKES);
  });

  it('gives the retake back if the camera fails', async () => {
    let calls = 0;
    const { session } = retakeSetup({
      grab: vi.fn(() => {
        if (++calls > SHOTS) throw new Error('camera unplugged');
        return calls;
      }),
    });
    await toSelect(session);
    await session.retake(3);
    expect(session.view).toMatchObject({ phase: 'select', retakesLeft: MAX_RETAKES, retakeOf: null });
  });

  it('a reset during a retake drops the session', async () => {
    const { deps, session } = retakeSetup();
    await toSelect(session);
    const pending = session.retake(1);
    session.reset();
    await pending;
    expect(session.view.phase).toBe('idle');
    expect(deps.deliver).not.toHaveBeenCalled();
  });
});
