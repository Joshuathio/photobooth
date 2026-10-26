import { setTimer } from '../shared/timers';

export class Cancelled extends Error {
  constructor() {
    super('Cancelled');
  }
}

/**
 * A delay as a promise that rejects with Cancelled when the signal aborts.
 * Runs on the worker timer so the countdown keeps time when the console tab is hidden.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Cancelled());
    const t = setTimer(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        t.cancel();
        reject(new Cancelled());
      },
      { once: true },
    );
  });
}
