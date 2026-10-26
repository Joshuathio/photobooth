import { useEffect, useRef } from 'react';

/**
 * The camera preview on the tablet. Frames are decoded off the main thread
 * (createImageBitmap) and drawn straight onto a canvas, so a new frame never
 * re-renders the rest of the guest screen. Every frame is acknowledged once
 * it's ready, which tells the Mac to send the next one.
 */
export class PreviewFrames {
  private latest: ImageBitmap | null = null;
  private readonly listeners = new Set<(frame: ImageBitmap) => void>();
  private decoding = false;
  private queued: Blob | null = null;

  constructor(private readonly ack: () => void) {}

  push(blob: Blob): void {
    if (this.decoding) {
      // Only the newest waiting frame matters; the one it replaces is acknowledged unseen.
      if (this.queued) this.ack();
      this.queued = blob;
      return;
    }
    void this.decode(blob);
  }

  private async decode(blob: Blob): Promise<void> {
    this.decoding = true;
    try {
      const frame = await createImageBitmap(blob);
      this.latest?.close();
      this.latest = frame;
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
}

/** Canvas that shows the latest preview frame. */
export function LivePreview({ frames }: { frames: PreviewFrames }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    return frames.subscribe((frame) => {
      if (canvas.width !== frame.width || canvas.height !== frame.height) {
        canvas.width = frame.width;
        canvas.height = frame.height;
      }
      ctx.drawImage(frame, 0, 0);
    });
  }, [frames]);
  return <canvas ref={ref} />;
}
