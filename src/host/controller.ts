import QRCode from 'qrcode';
import { Camera } from '../booth/camera';
import {
  buildAllSheet,
  printForBig,
  buildBigPrint,
  buildGif,
  buildSheet,
  buildStory,
  buildStrip,
  ensureFonts,
  ensureFrameArt,
  shotThumbnail,
  stripThumbnail,
  toJpeg,
} from '../booth/compose';
import type { DeckId } from '../booth/config';
import { FRAMES, frameById, secureRandom, type FrameId, type FrameStyle } from '../booth/gacha';
import { PreviewStream } from '../booth/preview-stream';
import { BoothSession, type BookInput, type DeliverInput, type DeliverResult } from '../booth/session';
import { hasCloud, loadSettings, saveSettings, type Settings } from '../booth/settings';
import { galleryLink, photoPublicId, publicId, uploadUnsigned, type AssetKey } from '../shared/cloudinary';
import { Link } from '../shared/link';
import type { GuestIntent } from '../shared/link-protocol';
import { generateSessionCode } from '../shared/session-code';
import { IDLE_VIEW, sampleView, type GuestView, type Phase, type PrintPackage } from '../shared/view';

export type LogLevel = 'info' | 'ok' | 'err';
export interface LogEntry {
  id: number;
  time: string;
  text: string;
  level: LogLevel;
}

export interface LastResult {
  code: string;
  frame: FrameId;
  pkg: PrintPackage;
  sheetUrl: string;
  gifUrl: string;
  link: string | null;
  qr: string | null;
}

export interface CameraOption {
  id: string;
  label: string;
}

export interface HostSnapshot {
  /** What the guest screen shows right now (live session or design preview). */
  view: GuestView;
  /** The real session, regardless of design preview. */
  live: GuestView;
  designPhase: Phase | null;
  settings: Settings;
  cameras: CameraOption[];
  cameraReady: boolean;
  cameraInfo: string | null;
  cameraMessage: string | null;
  stream: MediaStream | null;
  linkUp: boolean;
  tablets: number;
  consoles: number;
  /** False when a newer console tab took over the tablet; this one is then ignored. */
  activeConsole: boolean;
  lastResult: LastResult | null;
  log: LogEntry[];
}

const MAX_LOG = 200;

/**
 * Owns everything on the Mac side — camera, session, tablet link, upload —
 * and exposes one immutable snapshot for React (useSyncExternalStore).
 */
export class BoothController {
  private camera: Camera | null = null;
  private video: HTMLVideoElement | null = null;
  private preview: PreviewStream | null = null;
  private readonly link: Link;
  private readonly session: BoothSession<HTMLCanvasElement>;
  private readonly listeners = new Set<() => void>();
  private snapshot: HostSnapshot;
  private logId = 0;
  private lastSheet: { blob: Blob; code: string; pkg: PrintPackage } | null = null;
  /** Photos of the last session, so the book file can be made again on request. */
  private lastShots: BookInput<HTMLCanvasElement> | null = null;
  private objectUrls: string[] = [];
  /** The newest session's code: an older session that finishes late must not take over the result panel. */
  private newestCode = '';

  constructor() {
    this.snapshot = {
      view: IDLE_VIEW,
      live: IDLE_VIEW,
      designPhase: null,
      settings: loadSettings(),
      cameras: [],
      cameraReady: false,
      cameraInfo: null,
      cameraMessage: 'Menyiapkan kamera…',
      stream: null,
      linkUp: false,
      tablets: 0,
      consoles: 0,
      activeConsole: true,
      lastResult: null,
      log: [],
    };

    this.session = new BoothSession<HTMLCanvasElement>(
      {
        grab: () => this.camera!.grab(this.snapshot.settings.mirror),
        thumb: (shot) => shotThumbnail(shot),
        deliver: (input) => this.deliver(input),
        newCode: () => (this.newestCode = generateSessionCode()),
        random: secureRandom,
        log: (text, level) => this.log(text, level),
      },
      (live) => {
        this.patch({ live, ...(live.phase !== 'idle' ? { designPhase: null } : {}) });
        this.broadcast();
      },
    );

    // Chrome slows hidden tabs. Timers run on a worker now, but the camera can still
    // stutter, so tell the operator when the console isn't visible.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && this.snapshot.live.phase !== 'idle') {
        this.log('Console booth tidak kelihatan — biarkan jendela ini tetap di depan selama sesi', 'err');
      }
    });

    // Load the frame artwork up front so the first print isn't slowed down by it.
    for (const f of FRAMES) void ensureFrameArt(f);

    this.link = new Link('host', {
      onStatus: (up) => {
        this.patch({ linkUp: up });
        if (up) this.broadcast();
        else this.patch({ tablets: 0 });
        this.updatePreview();
      },
      onMessage: (msg) => {
        if (msg.type === 'peers') {
          const joined = msg.guests > this.snapshot.tablets;
          if (msg.guests !== this.snapshot.tablets) {
            this.log(msg.guests > 0 ? 'Tablet terhubung' : 'Tablet terputus', msg.guests > 0 ? 'ok' : 'err');
          }
          if (msg.hosts > 1 && this.snapshot.consoles <= 1) {
            this.log('Console booth terbuka di lebih dari satu tab — tablet ikut tab yang paling baru', 'err');
          }
          const active = msg.active ?? true;
          if (!active && this.snapshot.activeConsole) {
            this.log('Tab console ini tidak aktif lagi: tablet sekarang ikut tab console yang lebih baru', 'err');
          }
          const wasActive = this.snapshot.activeConsole;
          this.patch({ tablets: msg.guests, consoles: msg.hosts, activeConsole: active });
          if (joined || (active && !wasActive)) this.broadcast();
          this.updatePreview();
        } else if (msg.type === 'frameAck') {
          this.preview?.acked();
        } else if (msg.type === 'hello') {
          this.preview?.reset();
          this.broadcast(); // tablet (re)connected: send it the current screen
        } else if (msg.type === 'intent') {
          this.intent(msg.intent);
        }
      },
    });
  }

  /* ---------- React plumbing ---------- */
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): HostSnapshot => this.snapshot;

  private patch(p: Partial<HostSnapshot>): void {
    const next = { ...this.snapshot, ...p };
    next.view = next.designPhase && next.live.phase === 'idle' ? sampleView(next.designPhase) : next.live;
    this.snapshot = next;
    this.listeners.forEach((fn) => fn());
    this.updatePreview();
  }

  private broadcast(): void {
    this.link.send({ type: 'state', view: this.snapshot.view });
  }

  log(text: string, level: LogLevel = 'info'): void {
    const entry: LogEntry = {
      id: ++this.logId,
      time: new Date().toLocaleTimeString('en-GB'),
      text,
      level,
    };
    this.patch({ log: [...this.snapshot.log, entry].slice(-MAX_LOG) });
  }

  clearLog(): void {
    this.patch({ log: [] });
  }

  /* ---------- Camera ---------- */
  /** Callback ref for the big camera <video> on the console. */
  attachVideo = (el: HTMLVideoElement | null): void => {
    if (!el || el === this.video) return;
    this.video = el;
    this.camera = new Camera(el);
    this.preview = new PreviewStream(
      el,
      (frame) => this.link.sendFrame(frame),
      () => this.link.backlog < 500_000,
    );
    this.preview.mirror = this.snapshot.settings.mirror;
    void this.initCamera();
  };

  private async initCamera(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.patch({ cameraMessage: 'Browser ini tidak bisa akses kamera. Buka lewat http://localhost.' });
      this.log('getUserMedia tidak tersedia', 'err');
      return;
    }
    try {
      this.patch({ cameraMessage: 'Meminta izin kamera…' });
      await this.camera!.requestPermission();
      await this.refreshCameras();
      const saved = this.snapshot.settings.cameraId;
      const pick = this.snapshot.cameras.find((c) => c.id === saved)?.id ?? this.snapshot.cameras[0]?.id;
      await this.selectCamera(pick ?? '');
      navigator.mediaDevices.addEventListener('devicechange', () => void this.refreshCameras());
    } catch (err) {
      this.patch({ cameraMessage: 'Kamera tidak bisa dibuka. Cek izin kamera di browser.' });
      this.log(`Kamera diblokir: ${err instanceof Error ? err.message : String(err)}`, 'err');
    }
  }

  private async refreshCameras(): Promise<void> {
    if (!this.camera) return;
    const list = await this.camera.list();
    this.patch({ cameras: list.map((c, i) => ({ id: c.deviceId, label: c.label || `Kamera ${i + 1}` })) });
  }

  async selectCamera(deviceId: string): Promise<void> {
    if (!this.camera) return;
    this.patch({ cameraReady: false, cameraMessage: 'Membuka kamera…' });
    try {
      const { width, height } = await this.camera.open(deviceId || undefined);
      const label = this.snapshot.cameras.find((c) => c.id === this.camera!.activeDeviceId)?.label ?? 'Kamera';
      this.updateSettings({ cameraId: this.camera.activeDeviceId ?? deviceId });
      this.patch({
        cameraReady: true,
        cameraMessage: null,
        cameraInfo: `${label} · ${width}×${height}`,
        stream: this.camera.mediaStream,
      });
      this.log(`Kamera aktif: ${width}×${height}`, 'ok');
      this.updatePreview();
    } catch (err) {
      this.patch({ cameraMessage: 'Kamera ini tidak bisa dibuka. Coba pilih kamera lain.' });
      this.log(`Gagal membuka kamera: ${err instanceof Error ? err.message : String(err)}`, 'err');
    }
  }

  private updatePreview(): void {
    if (!this.preview) return;
    const s = this.snapshot;
    // Only stream while the tablet shows the camera (start screen and shooting).
    const shown = s.view.phase === 'idle' || s.view.phase === 'capturing';
    const want = s.linkUp && s.tablets > 0 && s.cameraReady && s.activeConsole && shown;
    if (want && !this.preview.running) this.preview.start();
    if (!want && this.preview.running) this.preview.stop();
  }

  /* ---------- Settings ---------- */
  updateSettings(p: Partial<Settings>): void {
    const settings = { ...this.snapshot.settings, ...p };
    saveSettings(settings);
    if (this.preview) this.preview.mirror = settings.mirror;
    this.patch({ settings });
  }

  /* ---------- Session controls ---------- */
  get defaultDeck(): DeckId {
    return this.snapshot.settings.deck;
  }

  /** Space / Mulai button on the Mac. */
  start(): void {
    if (!this.snapshot.cameraReady) {
      this.log('Kamera belum siap', 'err');
      return;
    }
    this.session.quickStart(this.defaultDeck);
  }

  reset(): void {
    this.session.reset();
  }

  /** Taps from the tablet, or clicks on the mirror. */
  intent(intent: GuestIntent): void {
    if (this.snapshot.view.preview) return; // design preview is look-only
    if (intent.type === 'start' && !this.snapshot.cameraReady) {
      this.log('Tablet minta mulai, tapi kamera belum siap', 'err');
      return;
    }
    this.session.handleIntent(intent, this.defaultDeck);
  }

  /** Cashier confirmed payment for the big print (all photos on one sheet). */
  approveUpgrade(): void {
    void this.session.approveUpgrade();
  }

  /** Not paid / changed their mind: back to picking 4 photos. */
  declineUpgrade(): void {
    this.session.declineUpgrade();
  }

  /** Builds the book file for the last session again (the guest tells the crew they want it). */
  async redownloadBook(): Promise<void> {
    if (!this.lastShots) return;
    try {
      await this.saveBook(this.lastShots);
    } catch (err) {
      this.log(`Gagal membuat file buku: ${err instanceof Error ? err.message : String(err)}`, 'err');
    }
  }

  /** Shows a guest screen with sample data on the mirror and the tablet. */
  setDesignPhase(phase: Phase | null): void {
    if (phase && this.snapshot.live.phase !== 'idle') return;
    if (phase && phase === this.snapshot.designPhase) {
      // Same screen clicked again: blank it for a moment so its animation replays.
      this.patch({ designPhase: null });
      this.broadcast();
      setTimeout(() => this.setDesignPhase(phase), 80);
      return;
    }
    this.patch({ designPhase: phase });
    this.broadcast();
  }

  redownloadSheet(): void {
    if (this.lastSheet) {
      download(this.lastSheet.blob, sheetFilename(this.lastSheet.code, this.lastSheet.pkg));
    }
  }

  /* ---------- Delivery ---------- */
  /** Frame PNG for printing; logs (and falls back to the frame colours) if it's missing. */
  private async loadArt(style: FrameStyle): Promise<void> {
    if (!style.art) return;
    if (!(await ensureFrameArt(style))) this.log(`File frame ${style.art.sheet} tidak bisa dibuka — pakai warna polos`, 'err');
  }

  /** Book keychain: the 16-photo landscape layout (8 photos × 2), turned for the printer. */
  private async saveBook({ code, shots, frame }: BookInput<HTMLCanvasElement>): Promise<void> {
    await Promise.all([ensureFonts(), this.loadArt(frameById(frame))]);
    const info = { eventName: this.snapshot.settings.eventName, date: new Date() };
    const blob = await toJpeg(printForBig(buildBigPrint(shots, info, frameById(frame))));
    const name = `buku-${code}.jpg`;
    download(blob, name);
    this.log(`Download ${name} (gantungan kunci buku)`, 'ok');
  }

  private async deliver({
    code,
    shots,
    chosen,
    pkg,
    frame,
  }: DeliverInput<HTMLCanvasElement>): Promise<DeliverResult> {
    const settings = this.snapshot.settings;
    const style = frameById(frame);
    const info = { eventName: settings.eventName, date: new Date() };
    await Promise.all([ensureFonts(), this.loadArt(style)]);

    // Every guest gets all 8 photos digitally, uncropped.
    const all = buildAllSheet(shots, info, style);
    // Printed: the strip with the 4 picks (twice), or the big sheet with all 8 small
    // landscape photos (twice). `shown` is the upright version for screens and the story.
    const strip = pkg === 'big' ? null : buildStrip(chosen.map((i) => shots[i]), info, style);
    const big = strip ? null : buildBigPrint(shots, info, style);
    const print = strip ? buildSheet(strip) : printForBig(big!);
    const shown = strip ?? big!;

    const [sheetBlob, storyBlob, allBlob] = await Promise.all([
      toJpeg(print),
      toJpeg(buildStory(shown)),
      toJpeg(all),
    ]);
    const gifBlob = buildGif(shots);
    const stripThumb = stripThumbnail(shown, strip ? 300 : 460);
    const kb = (b: Blob) => `${Math.round(b.size / 1024)}KB`;
    this.log(`Dibuat: sheet ${kb(sheetBlob)} · story ${kb(storyBlob)} · 8 foto ${kb(allBlob)} · gif ${kb(gifBlob)}`);

    // A session that finishes after a newer one has started still prints, but must not take
    // over the "last result" panel or free the newer session's images.
    let sheetUrl = '';
    let gifUrl = '';
    if (code === this.newestCode) {
      this.objectUrls.splice(0).forEach((u) => URL.revokeObjectURL(u));
      sheetUrl = this.objectUrl(sheetBlob);
      gifUrl = this.objectUrl(gifBlob);
      this.lastSheet = { blob: sheetBlob, code, pkg };
      this.lastShots = { code, shots, frame };
      this.patch({ lastResult: { code, frame, pkg, sheetUrl, gifUrl, link: null, qr: null } });
    }

    // The print sheet always lands on this Mac for the printer, on top of any cloud copy.
    // Both sheets are two identical halves, so both print with the same 2x6 cut.
    const sheetName = sheetFilename(code, pkg);
    download(sheetBlob, sheetName);
    this.log(`Download ${sheetName}`, pkg === 'big' ? 'ok' : 'info');

    const jobs: [AssetKey, string, Blob, string][] = [
      ['sheet', 'Sheet', sheetBlob, sheetName],
      ['story', 'Story', storyBlob, `story-${code}.jpg`],
      ['all', '8 foto', allBlob, `semua-${code}.jpg`],
      ['gif', 'GIF', gifBlob, `anim-${code}.gif`],
    ];

    if (!hasCloud(settings)) {
      this.log('Cloud belum diatur — story, 8 foto & GIF di-download lokal', 'err');
      for (const [key, , blob, filename] of jobs) if (key !== 'sheet') download(blob, filename);
      return { link: null, stripThumb };
    }

    // The 8 single photos, so guests can pick which ones to save. They're extras:
    // a failed one is logged but doesn't hold back the QR code.
    const photos = Promise.allSettled(
      shots.map(async (shot, i) =>
        uploadUnsigned(settings.cloudName, settings.uploadPreset, await toJpeg(shot), photoPublicId(code, i + 1)),
      ),
    ).then((results) => {
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed) this.log(`Upload foto satuan: ${failed} dari ${results.length} gagal`, 'err');
      else this.log(`Upload ${results.length} foto satuan berhasil`, 'ok');
    });

    const outcomes = await Promise.allSettled(
      jobs.map(([key, , blob]) =>
        uploadUnsigned(settings.cloudName, settings.uploadPreset, blob, publicId(code, key)),
      ),
    );
    await photos;
    let allUploaded = true;
    outcomes.forEach((o, i) => {
      const [key, label, blob, filename] = jobs[i];
      if (o.status === 'fulfilled') {
        this.log(`Upload ${label} berhasil`, 'ok');
        return;
      }
      allUploaded = false;
      this.log(`Upload ${label} gagal — ${(o.reason as Error).message}`, 'err');
      if (key !== 'sheet') download(blob, filename);
    });
    if (!allUploaded) return { link: null, stripThumb };

    if (!settings.galleryUrl) {
      this.log('Upload berhasil, tapi URL galeri kosong — QR tidak dibuat', 'err');
      return { link: null, stripThumb };
    }
    let link: string;
    try {
      link = galleryLink(settings.galleryUrl, code);
    } catch {
      this.log(`URL galeri tidak valid: ${settings.galleryUrl}`, 'err');
      return { link: null, stripThumb };
    }
    const qr = await QRCode.toDataURL(link, { margin: 1, width: 360 });
    if (code === this.newestCode) this.patch({ lastResult: { code, frame, pkg, sheetUrl, gifUrl, link, qr } });
    return { link, stripThumb };
  }

  private objectUrl(blob: Blob): string {
    const url = URL.createObjectURL(blob);
    this.objectUrls.push(url);
    return url;
  }
}

/** The big sheet gets its own name so it's easy to spot in Downloads. */
function sheetFilename(code: string, pkg: PrintPackage): string {
  return pkg === 'big' ? `sheet-${code}-besar.jpg` : `sheet-${code}.jpg`;
}

function download(blob: Blob, filename: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
