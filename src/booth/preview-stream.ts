import { setTimer, type TimerHandle } from '../shared/timers';

/** Frames sent but not yet shown on the tablet. More than this and we wait. */
const MAX_IN_FLIGHT = 2;
/** An ack that never comes (old tablet page, lost message) stops blocking after this. */
const ACK_TIMEOUT_MS = 1_000;

/**
 * Sends the live camera picture to the tablet as small JPEG frames, ~12 fps.
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
  mirror = true;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly send: (frame: Blob) => void,
    private readonly canSend: () => boolean,
    private readonly opts = { fps: 12, width: 640, quality: 0.6 },
  ) {}

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
    // Worker timer: keeps ~12 fps even when the console window is in the background.
    this.timer = setTimer(this.tick, 1000 / this.opts.fps);
    const { videoWidth: vw, videoHeight: vh } = this.video;
    if (this.encoding || vw === 0 || !this.canSend()) return;
    if (this.inFlight >= MAX_IN_FLIGHT) {
      if (Date.now() - this.lastSentAt < ACK_TIMEOUT_MS) return; // tablet still busy: skip this frame
      this.inFlight = 0;
    }

    const w = this.opts.width;
    const h = Math.round((w * vh) / vw);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const ctx = this.canvas.getContext('2d')!;
    ctx.setTransform(this.mirror ? -1 : 1, 0, 0, 1, this.mirror ? w : 0, 0);
    ctx.drawImage(this.video, 0, 0, w, h);

    this.encoding = true;
    this.canvas.toBlob(
      (blob) => {
        this.encoding = false;
        if (!blob || !this.timer) return;
        this.inFlight++;
        this.lastSentAt = Date.now();
        this.send(blob);
      },
      'image/jpeg',
      this.opts.quality,
    );
  };
}
