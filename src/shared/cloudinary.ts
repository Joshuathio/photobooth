import { ALL_CELL_H, ALL_CELL_W, ALL_COLS, ALL_GAP, ALL_MARGIN } from '../booth/config';

/** Every session's files live under booth/<CODE>/<asset>. */
export const ASSETS = {
  sheet: { name: 'sheet', ext: 'jpg' },
  story: { name: 'story', ext: 'jpg' },
  gif: { name: 'anim', ext: 'gif' },
  /** All 8 photos in the 16-cell book layout — every guest gets this digitally. */
  all: { name: 'all', ext: 'jpg' },
} as const;

export type AssetKey = keyof typeof ASSETS;

export const DEFAULT_CLOUD_NAME: string = import.meta.env?.VITE_CLOUDINARY_CLOUD_NAME || 'fbhrxtkn';

export function publicId(code: string, asset: AssetKey): string {
  return `booth/${code}/${ASSETS[asset].name}`;
}

export function deliveryUrl(cloud: string, code: string, asset: AssetKey): string {
  const { ext } = ASSETS[asset];
  return `https://res.cloudinary.com/${cloud}/image/upload/${publicId(code, asset)}.${ext}`;
}

/** fl_attachment forces a real download — the `download` attribute is ignored on cross-origin links. */
export function attachmentUrl(cloud: string, code: string, asset: AssetKey): string {
  const { ext } = ASSETS[asset];
  return `https://res.cloudinary.com/${cloud}/image/upload/fl_attachment/${publicId(code, asset)}.${ext}`;
}

/** Each of the 8 shots on its own, uncropped: booth/<CODE>/photo-1 … photo-8. */
export function photoPublicId(code: string, n: number): string {
  return `booth/${code}/photo-${n}`;
}

/**
 * One shot of a session, `n` from 1. `width` scales it down (thumbnails);
 * `download` adds fl_attachment so the browser saves it with a friendly name.
 */
export function photoUrl(
  cloud: string,
  code: string,
  n: number,
  opts: { width?: number; download?: boolean } = {},
): string {
  const steps: string[] = [];
  if (opts.width) steps.push(`c_scale,w_${opts.width}`);
  if (opts.download) steps.push(`fl_attachment:dearly-${code}-${n}`);
  const t = steps.length ? `${steps.join('/')}/` : '';
  return `https://res.cloudinary.com/${cloud}/image/upload/${t}${photoPublicId(code, n)}.jpg`;
}

/** Where shot `n` (from 1) sits on the 8-photo sheet — legacy grid of old sessions (see ALL_* in config). */
export function allSheetCell(n: number): { x: number; y: number; w: number; h: number } {
  const i = n - 1;
  return {
    x: ALL_MARGIN + (i % ALL_COLS) * (ALL_CELL_W + ALL_GAP),
    y: ALL_MARGIN + Math.floor(i / ALL_COLS) * (ALL_CELL_H + ALL_GAP),
    w: ALL_CELL_W,
    h: ALL_CELL_H,
  };
}

/**
 * Shot `n` cut out of the 8-photo sheet by Cloudinary. Sessions from before the
 * single photos were uploaded only have the sheet, so the gallery falls back to this.
 */
export function croppedPhotoUrl(
  cloud: string,
  code: string,
  n: number,
  opts: { width?: number; download?: boolean } = {},
): string {
  const { x, y, w, h } = allSheetCell(n);
  const steps = [`c_crop,x_${x},y_${y},w_${w},h_${h}`];
  if (opts.width) steps.push(`c_scale,w_${opts.width}`);
  if (opts.download) steps.push(`fl_attachment:dearly-${code}-${n}`);
  return `https://res.cloudinary.com/${cloud}/image/upload/${steps.join('/')}/${publicId(code, 'all')}.jpg`;
}

/** Appends ?s=CODE (or &s=CODE) to the hosted gallery page URL. */
export function galleryLink(galleryUrl: string, code: string): string {
  const url = new URL(galleryUrl);
  url.searchParams.set('s', code);
  return url.toString();
}

export async function uploadUnsigned(
  cloud: string,
  preset: string,
  blob: Blob,
  id: string,
): Promise<string> {
  const form = new FormData();
  form.append('file', blob);
  form.append('upload_preset', preset);
  form.append('public_id', id);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloud)}/image/upload`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 160)}`);
  }
  const json = (await res.json()) as { secure_url: string };
  return json.secure_url;
}
