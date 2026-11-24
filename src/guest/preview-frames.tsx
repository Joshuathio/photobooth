import { useEffect, useRef, useState } from 'react';
import { LINK_PATH } from '../shared/link-protocol';

/**
 * The camera preview on the tablet.
 *
 * Where the browser allows it (Chrome on the Galaxy Tab does), a worker does
 * all of it: it has its own socket to the booth, decodes each frame and draws
 * it onto an OffscreenCanvas, which reaches the screen on its own. Building
 * the countdown screen, the big countdown number and React re-renders keep
 * the page busy for a moment every second; before, frames waited behind that
 * work (and the Mac waited for their acks), so the preview skipped frames
 * exactly while the countdown was running.
 *
 * Elsewhere (tests, old browsers) frames are decoded with createImageBitmap
 * and drawn on the page, as before.
 *
 * Every frame is acknowledged once it's drawn (or replaced unseen), which
 * tells the Mac to send the next one.
 */

const WORKER_SOURCE = `
let canvas = null, ctx = null, latest = null, decoding = false, queued = null;
let drawn = 0, received = 0;

// The worker's own socket to the booth: frames come in and acks go out here,
// so nothing waits for the page.
let ws = null, url = null, lastHeard = 0;
function connect() {
  const sock = new WebSocket(url);
  sock.binaryType = 'blob';
  ws = sock;
  sock.onopen = () => { lastHeard = Date.now(); };
  sock.onmessage = (e) => {
    lastHeard = Date.now();
    if (e.data instanceof Blob) frame(e.data, 'ws');
  };
  sock.onclose = () => {
    if (ws !== sock) return;
    ws = null;
    setTimeout(connect, 1000);
  };
  sock.onerror = () => sock.close();
}
// A USB link that dropped quietly can leave a socket that looks open: the hub
// talks every few seconds, so 10 s of silence means rebuild it.
setInterval(() => {
  if (ws && ws.readyState === 1 && Date.now() - lastHeard > 10000) ws.close();
}, 2000);

function ack(from) {
  if (from === 'ws') {
    if (ws && ws.readyState === 1) ws.send('{"type":"frameAck"}');
  } else {
    postMessage('ack');
  }
}
function draw(f) {
  if (!ctx) return;
  if (canvas.width !== f.width || canvas.height !== f.height) {
    canvas.width = f.width;
    canvas.height = f.height;
  }
  ctx.drawImage(f, 0, 0);
  drawn++;
}
async function decode(item) {
  decoding = true;
  try {
    const f = await createImageBitmap(item.blob);
    if (latest) latest.close();
    latest = f;
    draw(f);
  } catch (e) {
    // A corrupt frame: skip it.
  }
  decoding = false;
  ack(item.from);
  const next = queued;
  queued = null;
  if (next) decode(next);
}
function frame(blob, from) {
  received++;
  if (decoding) {
    // Only the newest waiting frame matters; the one it replaces is acknowledged unseen.
    if (queued) ack(queued.from);
    queued = { blob, from };
  } else {
    decode({ blob, from });
  }
}
onmessage = (e) => {
  const m = e.data;
  if (m.type === 'canvas') {
    canvas = m.canvas;
    ctx = canvas.getContext('2d', { alpha: false });
    if (latest) draw(latest);
  } else if (m.type === 'frame') {
    frame(m.blob, 'page');
  } else if (m.type === 'connect') {
    url = m.url;
    connect();
  }
};
setInterval(() => {
  postMessage({ received, drawn });
  received = 0;
  drawn = 0;
}, 1000);
`;

export interface FrameStats {
  received: number;
  drawn: number;
}

function canUseWorker(): boolean {
  return (
    typeof Worker !== 'undefined' &&
    typeof OffscreenCanvas !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    'transferControlToOffscreen' in HTMLCanvasElement.prototype
  );
}

export class PreviewFrames {
  private latest: ImageBitmap | null = null;
  private readonly listeners = new Set<(frame: ImageBitmap) => void>();
  private readonly statsListeners = new Set<(stats: FrameStats) => void>();
  private decoding = false;
  private queued: Blob | null = null;
  private worker: Worker | null = null;
  /** Canvases already handed to the worker (a canvas can only be handed over once). */
  private readonly handedOver = new WeakSet<HTMLCanvasElement>();
  private received = 0;
  private drawn = 0;

  constructor(private readonly ack: () => void) {
    if (canUseWorker()) {
      try {
        const w = new Worker(URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' })));
        w.onmessage = (e: MessageEvent<'ack' | FrameStats>) => {
          if (e.data === 'ack') this.ack();
          else this.statsListeners.forEach((fn) => fn(e.data as FrameStats));
        };
        this.worker = w;
        // Its own socket to the booth. Until it's up (or if it can't connect),
        // the hub sends frames to the page instead, and push() passes them on.
        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        w.postMessage({ type: 'connect', url: `${proto}://${location.host}${LINK_PATH}?role=preview` });
      } catch {
        // Workers blocked: draw on the page instead.
      }
    }
    if (!this.worker && typeof setInterval !== 'undefined') {
      setInterval(() => {
        const stats = { received: this.received, drawn: this.drawn };
        this.received = 0;
        this.drawn = 0;
        this.statsListeners.forEach((fn) => fn(stats));
      }, 1000);
    }
  }

  /** True when frames are drawn in the worker (attach a canvas with `attach`). */
  get offscreen(): boolean {
    return this.worker !== null;
  }

  push(blob: Blob): void {
    if (this.worker) {
      this.worker.postMessage({ type: 'frame', blob });
      return;
    }
    this.received++;
    if (this.decoding) {
      if (this.queued) this.ack();
      this.queued = blob;
      return;
    }
    void this.decode(blob);
  }

  /** Worker mode: draw into this canvas from now on (the last one is dropped). */
  attach(canvas: HTMLCanvasElement): void {
    if (!this.worker || this.handedOver.has(canvas)) return;
    this.handedOver.add(canvas);
    const offscreen = canvas.transferControlToOffscreen();
    this.worker.postMessage({ type: 'canvas', canvas: offscreen }, [offscreen]);
  }

  private async decode(blob: Blob): Promise<void> {
    this.decoding = true;
    try {
      const frame = await createImageBitmap(blob);
      this.latest?.close();
      this.latest = frame;
      this.drawn++;
      this.listeners.forEach((fn) => fn(frame));
    } catch {
      // A corrupt frame: skip it.
    } finally {
      this.decoding = false;
      this.ack();
      const next = this.queued;
      this.queued = null;
      if (next) void this.decode(next);
    }
  }

  subscribe(fn: (frame: ImageBitmap) => void): () => void {
    this.listeners.add(fn);
    if (this.latest) fn(this.latest);
    return () => this.listeners.delete(fn);
  }

  /** Frames received and drawn in the last second, once a second. */
  onStats(fn: (stats: FrameStats) => void): () => void {
    this.statsListeners.add(fn);
    return () => this.statsListeners.delete(fn);
  }
}

/** Add ?fps to the tablet's address to see how many frames arrive and get drawn per second. */
const SHOW_FPS = typeof location !== 'undefined' && new URLSearchParams(location.search).has('fps');

/** Canvas that shows the latest preview frame. */
export function LivePreview({ frames }: { frames: PreviewFrames }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [stats, setStats] = useState<FrameStats | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    if (frames.offscreen) {
      frames.attach(canvas);
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    return frames.subscribe((frame) => {
      if (canvas.width !== frame.width || canvas.height !== frame.height) {
        canvas.width = frame.width;
        canvas.height = frame.height;
      }
      ctx.drawImage(frame, 0, 0);
    });
  }, [frames]);

  useEffect(() => (SHOW_FPS ? frames.onStats(setStats) : undefined), [frames]);

  return (
    <>
      <canvas ref={ref} />
      {SHOW_FPS && stats && (
        <span className="preview-fps">
          {frames.offscreen ? 'worker' : 'page'} · in {stats.received} · drawn {stats.drawn} fps
        </span>
      )}
    </>
  );
}
