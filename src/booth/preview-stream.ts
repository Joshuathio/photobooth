import { setTimer, type TimerHandle } from '../shared/timers';

/** Frames sent but not yet shown on the tablet. More than this and we wait. */
const MAX_IN_FLIGHT = 3;
/** An ack that never comes (old tablet page, lost message) stops blocking after this. */
const ACK_TIMEOUT_MS = 1_000;

const ENCODER_SOURCE = `
let canvas = null, ctx = null;
onmessage = async (e) => {
  const { bitmap, mirror, quality } = e.data;
  try {
    const w = bitmap.width, h = bitmap.height;
    if (!canvas || canvas.width !== w || canvas.height !== h) {
      canvas = new OffscreenCanvas(w, h);
      ctx = canvas.getContext('2d', { alpha: false });
    }
    ctx.setTransform(mirror ? -1 : 1, 0, 0, 1, mirror ? w : 0, 0);
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    postMessage(await canvas.convertToBlob({ type: 'image/jpeg', quality }));
  } catch (err) {
    postMessage(null);
  }
};`;

function startEncoder(): Worker | null {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap !== 'function') {
    return null;
  }
  try {
    return new Worker(URL.createObjectURL(new Blob([ENCODER_SOURCE], { type: 'text/javascript' })));
  } catch {
    return null;
  }
}

/**
 * Sends the live camera picture to the tablet as small JPEG frames, ~24 fps
 * (about 25 KB each, well under 1 MB/s over the USB link).
 *
 * Encoding runs in a worker (OffscreenCanvas.convertToBlob). canvas.toBlob on
 * the page waits for the page to be idle, and the console is busiest exactly
 * when the countdown screen opens, so frames used to stall there for up to a
 * second. Browsers without OffscreenCanvas fall back to canvas.toBlob.
 *
 * Flow control: the tablet acknowledges every frame it has drawn, and at most
 * MAX_IN_FLIGHT frames are on their way at once. When the tablet or the cable
 * is slower, frames are skipped here instead of queueing up — so the preview
 * stays live (a little choppier) rather than seconds behind.
 */
export class PreviewStream {
  private timer: TimerHandle | null = null;
  private encoding = false;
  private inFlight = 0;
  private lastSentAt = 0;
  private readonly canvas = document.createElement('canvas');
  private readonly encoder = startEncoder();
  mirror = true;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly send: (frame: Blob) => void,
    private readonly canSend: () => boolean,
    private readonly opts = { fps: 24, width: 560, quality: 0.55 },
  ) {
    if (this.encoder) this.encoder.onmessage = (e: MessageEvent<Blob | null>) => this.encoded(e.data);
  }

  get running(): boolean {
    return this.timer !== null;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setTimer(this.tick, 0);
  }

  stop(): void {
    this.timer?.cancel();
    this.timer = null;
    this.inFlight = 0;
  }

  /** The tablet drew a frame. */
  acked(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
  }

  /** The tablet (re)connected: nothing is in flight to it any more. */
  reset(): void {
    this.inFlight = 0;
  }

  private tick = (): void => {
    // Worker timer: keeps the frame rate even when the console window is in the background.
    this.timer = setTimer(this.tick, 1000 / this.opts.fps);
    const { videoWidth: vw, videoHeight: vh } = this.video;
    if (this.encoding || vw === 0 || !this.canSend()) return;
    if (this.inFlight >= MAX_IN_FLIGHT) {
      if (Date.now() - this.lastSentAt < ACK_TIMEOUT_MS) return; // tablet still busy: skip this frame
      this.inFlight = 0;
    }

    const w = this.opts.width;
    const h = Math.round((w * vh) / vw);
    this.encoding = true;

    if (this.encoder) {
      // The scale-down happens on the GPU here; drawing and JPEG encoding in the worker.
      const encoder = this.encoder;
      createImageBitmap(this.video, { resizeWidth: w, resizeHeight: h, resizeQuality: 'low' }).then(
        (bitmap) => encoder.postMessage({ bitmap, mirror: this.mirror, quality: this.opts.quality }, [bitmap]),
        () => this.encoded(null),
      );
      return;
    }

    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const ctx = this.canvas.getContext('2d')!;
    ctx.setTransform(this.mirror ? -1 : 1, 0, 0, 1, this.mirror ? w : 0, 0);
    ctx.drawImage(this.video, 0, 0, w, h);
    this.canvas.toBlob((blob) => this.encoded(blob), 'image/jpeg', this.opts.quality);
  };

  private encoded(blob: Blob | null): void {
    this.encoding = false;
    if (!blob || !this.timer) return;
    this.inFlight++;
    this.lastSentAt = Date.now();
    this.send(blob);
  }
}
