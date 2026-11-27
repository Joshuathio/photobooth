import { applyPalette, GIFEncoder, quantize } from 'gifenc';
import {
  CELL_H,
  CELL_W,
  COLORS,
  FONTS,
  FOOTER_Y,
  GAP,
  GIF_FRAME_MS,
  GIF_H,
  GIF_W,
  MARGIN_TOP,
  MARGIN_X,
  SHEET_H,
  SHEET_W,
  STORY_H,
  STORY_W,
  STRIP_W,
} from './config';
import type { FrameStyle } from './gacha';
import { containRect, coverCrop } from './layout';

export interface StripInfo {
  date: Date;
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  src: HTMLCanvasElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): void {
  const s = coverCrop(src.width, src.height, dw, dh);
  ctx.drawImage(src, s.x, s.y, s.w, s.h, dx, dy, dw, dh);
}

/** Canvas text silently falls back to another font if the web font isn't loaded yet. */
export async function ensureFonts(): Promise<void> {
  try {
    await Promise.all([
      document.fonts.load(`400 62px ${FONTS.script}`),
      document.fonts.load(`400 34px ${FONTS.chunky}`),
      document.fonts.load(`400 24px ${FONTS.body}`),
    ]);
  } catch {
    // Fonts are bundled, so this only fails in very old browsers; the fallback is fine.
  }
}

/* ---------- Frame artwork (PNG from the designer) ---------- */

const artLoads = new Map<string, Promise<HTMLImageElement | null>>();
const artImages = new Map<string, HTMLImageElement>();

/**
 * Loads a frame's PNG artwork once (it's bundled with the app, so this works offline).
 * Resolves to null for frames without art, or if the file can't be loaded — the
 * frame is then drawn from its colours instead.
 */
export function ensureFrameArt(frame: FrameStyle): Promise<HTMLImageElement | null> {
  const src = frame.art?.sheet;
  if (!src) return Promise.resolve(null);
  let load = artLoads.get(src);
  if (!load) {
    load = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        artImages.set(src, img);
        resolve(img);
      };
      img.onerror = () => {
        artLoads.delete(src); // try again next time
        resolve(null);
      };
      img.src = src;
    });
    artLoads.set(src, load);
  }
  return load;
}

function artFor(frame: FrameStyle): HTMLImageElement | null {
  return frame.art ? (artImages.get(frame.art.sheet) ?? null) : null;
}

/** Pattern repeat on the print: 60 px ≈ 5 mm at 300 dpi. */
const PATTERN_UNIT = 60;

/**
 * Frame colour plus its pattern (dots, stripes, gingham or sprinkles), the
 * same marks the guest saw on the set picker.
 */
export function paintFrame(
  ctx: CanvasRenderingContext2D,
  frame: FrameStyle,
  x: number,
  y: number,
  w: number,
  h: number,
  unit = PATTERN_UNIT,
): void {
  ctx.fillStyle = frame.bg;
  ctx.fillRect(x, y, w, h);
  if (frame.pattern === 'none') return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = frame.patternInk;
  const dots = (step: number, r: number, off: number) => {
    ctx.beginPath();
    for (let py = y + off; py < y + h + r; py += step) {
      for (let px = x + off; px < x + w + r; px += step) {
        ctx.moveTo(px + r, py);
        ctx.arc(px, py, r, 0, Math.PI * 2);
      }
    }
    ctx.fill();
  };
  switch (frame.pattern) {
    case 'dots':
      dots(unit / 2, unit * 0.1, unit / 4);
      break;
    case 'sprinkle':
      dots(unit, unit * 0.12, unit / 2);
      dots(unit / 2, unit * 0.055, unit / 8);
      break;
    case 'stripes':
      for (let px = x; px < x + w; px += unit / 2) ctx.fillRect(px, y, unit * 0.2, h);
      break;
    case 'check':
      // Gingham: vertical and horizontal bands; where they cross the colour doubles up.
      for (let px = x; px < x + w; px += unit) ctx.fillRect(px, y, unit / 2, h);
      for (let py = y; py < y + h; py += unit) ctx.fillRect(x, py, w, unit / 2);
      break;
  }
  ctx.restore();
}

/**
 * One strip at x = ox. Art frames: photos in the template holes, the designer's
 * PNG on top. Other frames: colour + pattern with a drawn footer. The session
 * code is not printed; guests get it on the tablet and in the QR link.
 */
function drawStrip(
  ctx: CanvasRenderingContext2D,
  ox: number,
  shots: HTMLCanvasElement[],
  info: StripInfo,
  frame: FrameStyle,
): void {
  const art = artFor(frame);
  if (art) {
    ctx.fillStyle = frame.bg;
    ctx.fillRect(ox, 0, STRIP_W, SHEET_H);
    // Photos fill the template cell; the art's own holes are the same size or a hair smaller.
    shots.forEach((shot, i) => {
      drawCover(ctx, shot, ox + MARGIN_X, MARGIN_TOP + i * (CELL_H + GAP), CELL_W, CELL_H);
    });
    // The sheet holds two identical strips; use the left one.
    ctx.drawImage(art, 0, 0, art.width / 2, art.height, ox, 0, STRIP_W, SHEET_H);

    return;
  }

  paintFrame(ctx, frame, ox, 0, STRIP_W, SHEET_H);

  shots.forEach((shot, i) => {
    const x = ox + MARGIN_X;
    const y = MARGIN_TOP + i * (CELL_H + GAP);
    ctx.fillStyle = frame.border;
    ctx.fillRect(x - 2, y - 2, CELL_W + 4, CELL_H + 4);
    drawCover(ctx, shot, x, y, CELL_W, CELL_H);
  });

  // Footer: the Dearly logo, date and the session code for the gallery.
  const cx = ox + STRIP_W / 2;
  const maxW = STRIP_W - 2 * MARGIN_X;
  const date = info.date.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  const lines: [string, string, string, number][] = [
    ['Dearly', frame.ink, `400 62px ${FONTS.script}`, 82],
    ['Photobooth', frame.accent, `400 32px ${FONTS.chunky}`, 132],
    [date, frame.dim, `400 22px ${FONTS.body}`, 174],
  ];
  ctx.textAlign = 'center';
  for (const [text, color, font, dy] of lines) {
    if (!text) continue;
    ctx.fillStyle = color;
    ctx.font = font;
    ctx.fillText(text, cx, FOOTER_Y + dy, maxW);
  }
}

export function buildStrip(
  shots: HTMLCanvasElement[],
  info: StripInfo,
  frame: FrameStyle,
): HTMLCanvasElement {
  const [c, ctx] = canvas(STRIP_W, SHEET_H);
  drawStrip(ctx, 0, shots, info, frame);
  return c;
}

/** Small 3:2 JPEG of one shot for the tablet's selection screen. */
export function shotThumbnail(shot: HTMLCanvasElement, width = 360): string {
  const h = Math.round(width / 1.5);
  const [c, ctx] = canvas(width, h);
  drawCover(ctx, shot, 0, 0, width, h);
  return c.toDataURL('image/jpeg', 0.72);
}

/** Small JPEG of the strip for the tablet's result screen. */
export function stripThumbnail(strip: HTMLCanvasElement, width = 300): string {
  const h = Math.round((strip.height * width) / strip.width);
  const [c, ctx] = canvas(width, h);
  ctx.drawImage(strip, 0, 0, width, h);
  return c.toDataURL('image/jpeg', 0.82);
}

/** Print sheet: two identical strips side by side. */
export function buildSheet(strip: HTMLCanvasElement): HTMLCanvasElement {
  const [c, ctx] = canvas(SHEET_W, SHEET_H);
  ctx.drawImage(strip, 0, 0);
  ctx.drawImage(strip, STRIP_W, 0);
  return c;
}

/** Blue gingham like the brand background: overlapping half-transparent stripes. */
function drawGingham(ctx: CanvasRenderingContext2D, w: number, h: number, size: number): void {
  ctx.fillStyle = COLORS.sky;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = COLORS.check;
  for (let x = 0; x < w; x += size) ctx.fillRect(x, 0, size / 2, h);
  for (let y = 0; y < h; y += size) ctx.fillRect(0, y, w, size / 2);
  // Fine diagonal weave.
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let d = -h; d < w; d += 7) {
    ctx.moveTo(d, h);
    ctx.lineTo(d + h, 0);
  }
  ctx.stroke();
  ctx.restore();
}

/** 9:16 story image: the strip, slightly tilted, on the Dearly gingham. */
export function buildStory(print: HTMLCanvasElement): HTMLCanvasElement {
  const [c, ctx] = canvas(STORY_W, STORY_H);
  drawGingham(ctx, STORY_W, STORY_H, 150);
  const r = containRect(print.width, print.height, STORY_W, STORY_H, 0.86);
  ctx.save();
  ctx.translate(STORY_W / 2, STORY_H / 2);
  ctx.rotate((-3 * Math.PI) / 180);
  ctx.shadowColor = COLORS.shadow;
  ctx.shadowBlur = 50;
  ctx.shadowOffsetY = 24;
  ctx.drawImage(print, -r.w / 2, -r.h / 2, r.w, r.h);
  ctx.restore();
  return c;
}

export function buildGif(shots: HTMLCanvasElement[]): Blob {
  const enc = GIFEncoder();
  const [, ctx] = canvas(GIF_W, GIF_H);
  for (const shot of shots) {
    ctx.fillStyle = COLORS.cream;
    ctx.fillRect(0, 0, GIF_W, GIF_H);
    drawCover(ctx, shot, 0, 0, GIF_W, GIF_H);
    const { data } = ctx.getImageData(0, 0, GIF_W, GIF_H);
    const palette = quantize(data, 256);
    enc.writeFrame(applyPalette(data, palette), GIF_W, GIF_H, { palette, delay: GIF_FRAME_MS });
  }
  enc.finish();
  return new Blob([enc.bytes() as BlobPart], { type: 'image/gif' });
}

export function toJpeg(c: HTMLCanvasElement, quality = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas export failed'))), 'image/jpeg', quality),
  );
}
