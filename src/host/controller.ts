import QRCode from 'qrcode';
import { Camera } from '../booth/camera';
import {
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
import { BoothSession, type DeliverInput, type DeliverResult } from '../booth/session';
import { hasCloud, loadSettings, saveSettings, type Settings } from '../booth/settings';
import { galleryLink, photoPublicId, publicId, uploadUnsigned, type AssetKey } from '../shared/cloudinary';
import { Link } from '../shared/link';
import type { GuestIntent } from '../shared/link-protocol';
import { generateSessionCode } from '../shared/session-code';
import { zipBlob, type ZipEntry } from '../shared/zip';
import { IDLE_VIEW, sampleView, type GuestView, type Phase } from '../shared/view';

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
  private lastSheet: { blob: Blob; code: string } | null = null;
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
        thumb: (shot, width) => shotThumbnail(shot, width),
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

  /** One more retake for the guest on the tablet (e.g. the camera glitched). */
  grantRetake(): void {
    this.session.grantRetake();
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
      download(this.lastSheet.blob, sheetFilename(this.lastSheet.code));
    }
  }

  /* ---------- Delivery ---------- */
  /** Frame PNG for printing; logs (and falls back to the frame colours) if it's missing. */
  private async loadArt(style: FrameStyle): Promise<void> {
    if (!style.art) return;
    if (!(await ensureFrameArt(style))) this.log(`File frame ${style.art.sheet} tidak bisa dibuka — pakai warna polos`, 'err');
  }

  /**
   * Every session is saved on this Mac as ONE zip (dearly-KODE.zip: 8 single photos, print sheet,
   * story and GIF), whatever the signal does. If building the sheets fails, the zip still gets the
   * 8 originals.
   */
  private async deliver(input: DeliverInput<HTMLCanvasElement>): Promise<DeliverResult> {
    const { code, shots } = input;
    const files: ZipEntry[] = [];
    try {
      const singles = await Promise.all(shots.map(async (shot) => new Uint8Array(await (await toJpeg(shot)).arrayBuffer())));
      singles.forEach((data, i) => files.push({ name: `dearly-${code}/foto-${code}-${i + 1}.jpg`, data }));
    } catch (err) {
      this.log(`Foto satuan tidak bisa disiapkan untuk zip: ${err instanceof Error ? err.message : String(err)}`, 'err');
    }
    try {
      return await this.deliverBuilt(input, files);
    } catch (err) {
      await this.saveZip(code, files);
      throw err;
    }
  }

  private async deliverBuilt(
    { code, shots, chosen, frame }: DeliverInput<HTMLCanvasElement>,
    files: ZipEntry[],
  ): Promise<DeliverResult> {
    const settings = this.snapshot.settings;
    const style = frameById(frame);
    const info = { date: new Date() };

    await Promise.all([ensureFonts(), this.loadArt(style)]);

    // Printed: the strip with the 4 picks, twice on one sheet.
    const picks = chosen.map((i) => shots[i]);
    const strip = buildStrip(picks, info, style);
    const [sheetBlob, storyBlob] = await Promise.all([toJpeg(buildSheet(strip)), toJpeg(buildStory(strip))]);
    const gifBlob = buildGif(shots);
    const stripThumb = stripThumbnail(strip, 300);
    const kb = (b: Blob) => `${Math.round(b.size / 1024)}KB`;
    this.log(`Dibuat: sheet ${kb(sheetBlob)} · story ${kb(storyBlob)} · gif ${kb(gifBlob)}`);

    // A session that finishes after a newer one has started still prints, but must not take
    // over the "last result" panel or free the newer session's images.
    let sheetUrl = '';
    let gifUrl = '';
    if (code === this.newestCode) {
      this.objectUrls.splice(0).forEach((u) => URL.revokeObjectURL(u));
      sheetUrl = this.objectUrl(sheetBlob);
      gifUrl = this.objectUrl(gifBlob);
      this.lastSheet = { blob: sheetBlob, code };
      this.patch({ lastResult: { code, frame, sheetUrl, gifUrl, link: null, qr: null } });
    }

    // The print sheet is for the printer: two identical strips, printed with the 2x6 cut.
    // The rest is saved here too, on top of any cloud copy.
    const jobs: [AssetKey, string, Blob, string][] = [
      ['sheet', 'Sheet', sheetBlob, sheetFilename(code)],
      ['story', 'Story', storyBlob, `story-${code}.jpg`],
      ['gif', 'GIF', gifBlob, `anim-${code}.gif`],
    ];
    for (const [, , blob, filename] of jobs) {
      files.push({ name: `dearly-${code}/${filename}`, data: new Uint8Array(await blob.arrayBuffer()) });
    }
    await this.saveZip(code, files);

    if (!hasCloud(settings)) {
      this.log('Cloud belum diatur — semua file hanya tersimpan lokal', 'err');
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
      const label = jobs[i][1];
      if (o.status === 'fulfilled') {
        this.log(`Upload ${label} berhasil`, 'ok');
        return;
      }
      allUploaded = false;
      this.log(`Upload ${label} gagal — ${(o.reason as Error).message} (file sudah tersimpan lokal)`, 'err');
    });
    if (!allUploaded) return { link: null, stripThumb };

    if (!settings.galleryUrl) {
      this.log('Upload berhasil, tapi URL galeri kosong — QR tidak dibuat', 'err');
      return { link: null, stripThumb };
    }
    let link: string;
    try {
      link = galleryLink(settings.galleryUrl, code, settings.cloudName);
    } catch {
      this.log(`URL galeri tidak valid: ${settings.galleryUrl}`, 'err');
      return { link: null, stripThumb };
    }
    const qr = await QRCode.toDataURL(link, { margin: 1, width: 360 });
    if (code === this.newestCode) this.patch({ lastResult: { code, frame, sheetUrl, gifUrl, link, qr } });
    return { link, stripThumb };
  }

  /** Sessions whose zip is already saved, so a late failure doesn't save it twice. */
  private readonly zipped = new Set<string>();

  /** One zip per session in this Mac's Downloads folder. */
  private async saveZip(code: string, files: ZipEntry[]): Promise<void> {
    if (!files.length || this.zipped.has(code)) return;
    this.zipped.add(code);
    try {
      const blob = zipBlob(files);
      download(blob, `dearly-${code}.zip`);
      this.log(`Disimpan lokal: dearly-${code}.zip (${files.length} file, ${Math.round(blob.size / 1024)}KB)`, 'ok');
    } catch (err) {
      this.log(`Gagal menyimpan dearly-${code}.zip: ${err instanceof Error ? err.message : String(err)}`, 'err');
    }
  }

  private objectUrl(blob: Blob): string {
    const url = URL.createObjectURL(blob);
    this.objectUrls.push(url);
    return url;
  }
}

function sheetFilename(code: string): string {
  return `sheet-${code}.jpg`;
}

function download(blob: Blob, filename: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
