import { applyPalette, GIFEncoder, quantize } from 'gifenc';
import {
  BIG_CELL_H,
  BIG_CELL_W,
  BIG_COLS,
  BIG_FOOTER_X,
  BIG_H,
  BIG_ROWS,
  BIG_W,
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
  eventName: string;
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

/** Colour for small text on a frame: the outline colour where the lettering is outlined. */
function solidInk(frame: FrameStyle): string {
  return frame.outline ?? frame.ink;
}

/** Text in the frame's lettering style: filled, with the outline behind it when the frame has one. */
function letter(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  font: string,
  fill: string,
  outline: string | undefined,
  maxW: number,
): void {
  ctx.font = font;
  if (outline) {
    ctx.strokeStyle = outline;
    ctx.lineWidth = Math.max(4, parseInt(font.split(' ')[1], 10) * 0.16);
    ctx.lineJoin = 'round';
    ctx.strokeText(text, x, y, maxW);
  }
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y, maxW);
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

  // Footer: the Dearly logo, date, event and the session code for the gallery.
  const cx = ox + STRIP_W / 2;
  const maxW = STRIP_W - 2 * MARGIN_X;
  const date = info.date.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  const lines: [string, string, string, number][] = [
    ['Dearly', frame.ink, `400 62px ${FONTS.script}`, 82],
    ['Photobooth', frame.accent, `400 32px ${FONTS.chunky}`, 132],
    [date, frame.dim, `400 22px ${FONTS.body}`, 174],
    [info.eventName, frame.dim, `400 20px ${FONTS.body}`, 206],
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

/**
 * Whole-sheet frame (the BINUS ones): a 4R printed uncut, photo i in row i of
 * both columns, the designer's PNG on top. The art must be loaded first
 * (ensureFrameArt); without it the photos still print on the frame colour.
 */
export function buildGridSheet(shots: HTMLCanvasElement[], frame: FrameStyle): HTMLCanvasElement {
  const [c, ctx] = canvas(SHEET_W, SHEET_H);
  ctx.fillStyle = frame.bg;
  ctx.fillRect(0, 0, SHEET_W, SHEET_H);
  const grid = frame.grid;
  if (grid) {
    grid.rows.forEach(([y0, y1], i) => {
      const shot = shots[i];
      if (!shot) return;
      for (const [x0, x1] of grid.cols) drawCover(ctx, shot, x0, y0, x1 - x0, y1 - y0);
    });
  }
  const art = artFor(frame);
  if (art) ctx.drawImage(art, 0, 0, SHEET_W, SHEET_H);
  return c;
}

/** Small 3:2 JPEG of one shot for the tablet's selection screen. */
export function shotThumbnail(shot: HTMLCanvasElement, width = 360): string {
  const h = Math.round(width / 1.5);
  const [c, ctx] = canvas(width, h);
  drawCover(ctx, shot, 0, 0, width, h);
  return c.toDataURL('image/jpeg', 0.72);
}

/**
 * Big print, upright: a landscape 1800 × 1200 canvas with two identical halves
 * (top and bottom). Each half has the 8 shots in 4 columns × 2 rows of
 * 3.5 × 2.55 cm cells and a narrow footer on the right. Use this for screens;
 * printForBig() turns it for the printer.
 */
export function buildBigPrint(
  shots: HTMLCanvasElement[],
  info: StripInfo,
  frame: FrameStyle,
): HTMLCanvasElement {
  const [c, ctx] = canvas(BIG_W, BIG_H);
  paintFrame(ctx, frame, 0, 0, BIG_W, BIG_H);
  const halfH = BIG_H / 2;
  const date = info.date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  const fx = BIG_FOOTER_X + (BIG_W - BIG_FOOTER_X) / 2;
  const maxW = BIG_W - BIG_FOOTER_X - 14;

  for (const oy of [0, halfH]) {
    shots.forEach((shot, i) => {
      if (i >= BIG_COLS * BIG_ROWS) return;
      const x = (i % BIG_COLS) * BIG_CELL_W;
      const y = oy + Math.floor(i / BIG_COLS) * BIG_CELL_H;
      drawCover(ctx, shot, x, y, BIG_CELL_W, BIG_CELL_H);
    });

    // Footer column, stacked and centred in this half.
    ctx.textAlign = 'center';
    if (frame.art) {
      // Same hand lettering as the strip art: "with love, Dearly".
      const ink = solidInk(frame);
      letter(ctx, 'with love,', fx, oy + 206, `400 24px ${FONTS.script}`, frame.ink, frame.outline, maxW);
      letter(ctx, 'Dearly', fx, oy + 250, `400 40px ${FONTS.script}`, frame.ink, frame.outline, maxW);
      const small: [string, string, number][] = [
        [date, `400 15px ${FONTS.body}`, 306],
        [info.eventName, `400 12px ${FONTS.body}`, 328],
      ];
      ctx.fillStyle = ink;
      for (const [text, font, dy] of small) {
        if (!text) continue;
        ctx.font = font;
        ctx.fillText(text, fx, oy + dy, maxW);
      }
      continue;
    }
    const lines: [string, string, string, number][] = [
      ['Dearly', frame.ink, `400 34px ${FONTS.script}`, 232],
      ['Photobooth', frame.accent, `400 16px ${FONTS.chunky}`, 264],
      [date, frame.dim, `400 15px ${FONTS.body}`, 306],
      [info.eventName, frame.dim, `400 12px ${FONTS.body}`, 328],
    ];
    for (const [text, color, font, dy] of lines) {
      if (!text) continue;
      ctx.fillStyle = color;
      ctx.font = font;
      ctx.fillText(text, fx, oy + dy, maxW);
    }
  }
  return c;
}

/**
 * The big print turned 90° onto the portrait 4x6 sheet the printer expects,
 * so its 2x6 cut runs between the two identical halves.
 */
export function printForBig(big: HTMLCanvasElement): HTMLCanvasElement {
  const [c, ctx] = canvas(SHEET_W, SHEET_H);
  ctx.translate(SHEET_W, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(big, 0, 0);
  return c;
}

/** Small JPEG of the strip (or big sheet) for the tablet's result screen. */
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

/** 9:16 story image: the strip (or big sheet), slightly tilted, on the Dearly gingham. */
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
