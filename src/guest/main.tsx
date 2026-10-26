import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Link } from '../shared/link';
import { IDLE_VIEW, type GuestView } from '../shared/view';
import { ScaledStage } from '../ui/ScaledStage';
import '../ui/stage.css';
import { GuestScreen, STAGE_H, STAGE_W } from './GuestScreen';
import './guest.css';
import { LivePreview, PreviewFrames } from './preview-frames';

/** Keeps the tablet awake and fullscreen, and stops long-press menus. */
function useKioskMode(): void {
  useEffect(() => {
    const goFullscreen = () => {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
    };
    const noMenu = (e: Event) => e.preventDefault();
    let lock: WakeLockSentinel | null = null;
    const keepAwake = async () => {
      try {
        lock = (await navigator.wakeLock?.request('screen')) ?? null;
      } catch {
        // Not supported or not allowed — the tablet's own screen timeout applies.
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void keepAwake();
    };
    window.addEventListener('pointerdown', goFullscreen);
    window.addEventListener('contextmenu', noMenu);
    document.addEventListener('visibilitychange', onVisible);
    void keepAwake();
    return () => {
      window.removeEventListener('pointerdown', goFullscreen);
      window.removeEventListener('contextmenu', noMenu);
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release();
    };
  }, []);
}

/**
 * If the link stays down while the booth server is answering (e.g. the server
 * was restarted with a new build and this tab still runs the old code), reload
 * the page. Never reloads when the server is unreachable, so Chrome doesn't end
 * up on its own error page.
 */
function useSelfHeal(linkUp: boolean): void {
  useEffect(() => {
    if (linkUp) return;
    const id = setInterval(async () => {
      try {
        const res = await fetch(`${location.pathname}?alive=${Date.now()}`, { cache: 'no-store' });
        if (res.ok) location.reload();
      } catch {
        // Server not reachable yet: keep waiting for the cable / server.
      }
    }, 15_000);
    return () => clearInterval(id);
  }, [linkUp]);
}

function GuestApp() {
  const [view, setView] = useState<GuestView>(IDLE_VIEW);
  const [linkUp, setLinkUp] = useState(false);
  const [hosts, setHosts] = useState(0);
  const link = useRef<Link | null>(null);
  // Camera frames bypass React state: drawing one must not re-render the whole screen.
  const frames = useMemo(() => new PreviewFrames(() => link.current?.send({ type: 'frameAck' })), []);

  useEffect(() => {
    const l = new Link('guest', {
      onStatus: (up) => {
        setLinkUp(up);
        if (up) l.send({ type: 'hello' }); // get the current screen, whatever happened while away
        else setHosts(0);
      },
      onMessage: (msg) => {
        if (msg.type === 'state') setView(msg.view);
        else if (msg.type === 'peers') setHosts(msg.hosts);
      },
      onFrame: (blob) => frames.push(blob),
    });
    link.current = l;
    return () => l.close();
  }, [frames]);

  useKioskMode();
  useSelfHeal(linkUp);

  const online = linkUp && hosts > 0;
  const preview = useMemo(() => <LivePreview frames={frames} />, [frames]);

  return (
    <ScaledStage width={STAGE_W} height={STAGE_H}>
      <GuestScreen
        view={view}
        preview={preview}
        onIntent={(intent) => link.current?.send({ type: 'intent', intent })}
      />
      {!online && (
        <div className="guest-offline gingham">
          <div className="guest-offline__card paper">
            <h1 className="sticker">Sebentar ya…</h1>
            <p>
              {linkUp
                ? 'Tablet sudah tersambung. Buka console booth di Mac (http://localhost:5173).'
                : 'Menghubungkan ke booth. Cek kabel USB, dan pastikan “npm run booth” dan “npm run tablet:watch” jalan di Mac.'}
            </p>
          </div>
        </div>
      )}
    </ScaledStage>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GuestApp />
  </StrictMode>,
);
