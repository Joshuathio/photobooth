import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Plugin } from 'vite';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { HEARTBEAT_MS, LINK_PATH, type Role } from '../src/shared/link-protocol';

/** Preview frames are dropped for a client that falls this far behind. */
const MAX_BUFFERED_BYTES = 2_000_000;

/**
 * Tiny relay between the Mac console ("host") and the tablet ("guest").
 *
 * - Only the most recently opened console is "active": the tablet's taps go to
 *   it and only its screens reach the tablet. A forgotten second console tab
 *   can't run a session of its own in parallel.
 * - Every HEARTBEAT_MS everyone gets a `peers` message, and sockets that stop
 *   answering pings (cable pulled mid-session, Mac asleep) are dropped, so
 *   both sides notice a dead link and reconnect.
 */
export function createLinkHub({ heartbeatMs = HEARTBEAT_MS }: { heartbeatMs?: number } = {}) {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Map<WebSocket, { role: Role; alive: boolean; since: number }>();
  let order = 0;

  const peers = () => {
    let hosts = 0;
    let guests = 0;
    for (const c of clients.values()) c.role === 'host' ? hosts++ : guests++;
    return { hosts, guests };
  };

  /** The console the tablet follows: the newest open one. */
  const activeHost = (): WebSocket | null => {
    let best: WebSocket | null = null;
    let bestSince = -1;
    for (const [ws, c] of clients) {
      if (c.role === 'host' && ws.readyState === WebSocket.OPEN && c.since > bestSince) {
        best = ws;
        bestSince = c.since;
      }
    }
    return best;
  };

  const announcePeers = () => {
    const counts = peers();
    const active = activeHost();
    for (const [ws, c] of clients) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      const msg = c.role === 'host' ? { type: 'peers', ...counts, active: ws === active } : { type: 'peers', ...counts };
      ws.send(JSON.stringify(msg));
    }
  };

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const role: Role =
      new URL(req.url ?? '/', 'http://localhost').searchParams.get('role') === 'host' ? 'host' : 'guest';
    clients.set(ws, { role, alive: true, since: order++ });
    announcePeers();

    ws.on('pong', () => {
      const c = clients.get(ws);
      if (c) c.alive = true;
    });
    ws.on('message', (data: RawData, isBinary: boolean) => {
      if (role === 'host') {
        if (ws !== activeHost()) return; // an older console tab: ignored
        for (const [peer, c] of clients) {
          if (c.role !== 'guest' || peer.readyState !== WebSocket.OPEN) continue;
          if (isBinary && peer.bufferedAmount > MAX_BUFFERED_BYTES) continue;
          peer.send(data, { binary: isBinary });
        }
      } else {
        const host = activeHost();
        if (host) host.send(data, { binary: isBinary });
      }
    });
    ws.on('close', () => {
      clients.delete(ws);
      announcePeers();
    });
    ws.on('error', () => ws.terminate());
  });

  const heartbeat = setInterval(() => {
    for (const [ws, c] of clients) {
      if (!c.alive) {
        ws.terminate(); // 'close' removes it and tells everyone
        continue;
      }
      c.alive = false;
      try {
        ws.ping();
      } catch {
        ws.terminate();
      }
    }
    announcePeers();
  }, heartbeatMs);

  return {
    handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    },
    peers,
    close(): void {
      clearInterval(heartbeat);
      for (const ws of clients.keys()) ws.terminate();
      wss.close();
    },
  };
}

/** Attaches the hub to an HTTP server, leaving every other upgrade (e.g. Vite HMR) alone. */
export function attachLinkHub(server: Server, opts?: { heartbeatMs?: number }): ReturnType<typeof createLinkHub> {
  const hub = createLinkHub(opts);
  server.on('close', () => hub.close());
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path === LINK_PATH) hub.handleUpgrade(req, socket, head);
  });
  return hub;
}

/** Vite plugin: runs the hub inside `npm run dev` and `npm run preview`. */
export function boothLink(): Plugin {
  return {
    name: 'booth-link',
    configureServer(server) {
      if (server.httpServer) attachLinkHub(server.httpServer as Server);
    },
    configurePreviewServer(server) {
      if (server.httpServer) attachLinkHub(server.httpServer as Server);
    },
  };
}
