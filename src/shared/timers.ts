/**
 * setTimeout that keeps its pace when the console tab is hidden or covered by
 * another window. Chrome slows timers in background tabs (down to once a
 * minute after a while), which would freeze the countdown and the tablet's
 * camera preview. Timers inside a worker aren't slowed, so the delays run
 * there and only the callback comes back to the page.
 *
 * Falls back to plain setTimeout where there are no workers (tests, Node).
 */
export interface TimerHandle {
  cancel(): void;
}

const WORKER_SOURCE = `
const timers = new Map();
onmessage = (e) => {
  const [op, id, ms] = e.data;
  if (op === 'set') {
    timers.set(id, setTimeout(() => { timers.delete(id); postMessage(id); }, ms));
  } else {
    clearTimeout(timers.get(id));
    timers.delete(id);
  }
};`;

let worker: Worker | null | undefined;
const callbacks = new Map<number, () => void>();
let nextId = 1;

function timerWorker(): Worker | null {
  if (worker !== undefined) return worker;
  worker = null;
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return worker;
  }
  try {
    const w = new Worker(URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' })));
    w.onmessage = (e: MessageEvent<number>) => {
      const fn = callbacks.get(e.data);
      callbacks.delete(e.data);
      fn?.();
    };
    worker = w;
  } catch {
    // Workers blocked: plain timers still work, just slower when the tab is hidden.
  }
  return worker;
}

export function setTimer(fn: () => void, ms: number): TimerHandle {
  const w = timerWorker();
  if (!w) {
    const t = setTimeout(fn, ms);
    return { cancel: () => clearTimeout(t) };
  }
  const id = nextId++;
  callbacks.set(id, fn);
  w.postMessage(['set', id, ms]);
  return {
    cancel: () => {
      if (!callbacks.delete(id)) return;
      w.postMessage(['clear', id]);
    },
  };
}
