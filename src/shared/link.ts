import { LINK_PATH, STALE_MS, type LinkMessage, type Role } from './link-protocol';

export interface LinkHandlers {
  onMessage(msg: LinkMessage): void;
  /** Binary preview frame (tablet only). */
  onFrame?(frame: Blob): void;
  onStatus?(connected: boolean): void;
}

/**
 * WebSocket to the booth hub that reconnects on its own (cable pulled, server
 * restarted…). The hub sends a heartbeat every few seconds; if nothing arrives
 * for STALE_MS the link is treated as dead and rebuilt, because a USB link that
 * dropped quietly can leave a socket that looks open but delivers nothing.
 */
export class Link {
  private ws: WebSocket | null = null;
  private retryMs = 500;
  private retryTimer = 0;
  private watchdog = 0;
  private lastHeard = 0;
  private up = false;
  private closed = false;

  constructor(
    private readonly role: Role,
    private readonly handlers: LinkHandlers,
  ) {
    this.connect();
    this.watchdog = window.setInterval(() => {
      if (this.up && Date.now() - this.lastHeard > STALE_MS) this.drop();
    }, 2_000);
  }

  get connected(): boolean {
    return this.up && this.ws?.readyState === WebSocket.OPEN;
  }

  /** Bytes queued but not yet sent — used to skip preview frames on a slow link. */
  get backlog(): number {
    return this.ws?.bufferedAmount ?? 0;
  }

  private connect(): void {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}${LINK_PATH}?role=${this.role}`);
    ws.binaryType = 'blob';
    this.ws = ws;
    // A connect that never opens (e.g. adb forwarding gone half-way) is retried too.
    window.setTimeout(() => {
      if (this.ws === ws && !this.up) this.drop();
    }, 5_000);

    ws.onopen = () => {
      this.retryMs = 500;
      this.up = true;
      this.lastHeard = Date.now();
      this.handlers.onStatus?.(true);
    };
    ws.onmessage = (e: MessageEvent) => {
      this.lastHeard = Date.now();
      if (e.data instanceof Blob) {
        this.handlers.onFrame?.(e.data);
        return;
      }
      try {
        this.handlers.onMessage(JSON.parse(e.data as string) as LinkMessage);
      } catch {
        // Ignore malformed messages.
      }
    };
    ws.onclose = () => {
      if (this.ws === ws) this.lost();
    };
    ws.onerror = () => ws.close();
  }

  /** Gives up on a silent socket right away instead of waiting for TCP to notice. */
  private drop(): void {
    const ws = this.ws;
    if (!ws) return;
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
    try {
      ws.close();
    } catch {
      // Already closing.
    }
    this.lost();
  }

  private lost(): void {
    const wasUp = this.up;
    this.up = false;
    this.ws = null;
    if (wasUp) this.handlers.onStatus?.(false);
    if (this.closed) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = window.setTimeout(() => this.connect(), this.retryMs);
    this.retryMs = Math.min(this.retryMs * 2, 4000);
  }

  send(msg: LinkMessage): void {
    if (this.connected) this.ws!.send(JSON.stringify(msg));
  }

  sendFrame(frame: Blob): void {
    if (this.connected) this.ws!.send(frame);
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.retryTimer);
    clearInterval(this.watchdog);
    this.ws?.close();
  }
}
