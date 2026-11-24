import '../styles/gallery.css';
import {
  attachmentUrl,
  croppedPhotoUrl,
  cloudsToTry,
  deliveryUrl,
  photoUrl,
  type AssetKey,
} from '../shared/cloudinary';
import { SHOTS as PHOTO_COUNT } from '../booth/config';
import { isValidSessionCode, normalizeSessionCode } from '../shared/session-code';

// QR links say which Cloudinary account the photos went to (?c=…). For typed-in codes and
// older QR links, every account the booth has used is tried (see cloudsToTry).
const CLOUDS = cloudsToTry(new URLSearchParams(location.search).get('c'));
/** The account the shown session was found in. */
let CLOUD_NAME = CLOUDS[0];

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

const codeForm = $<HTMLFormElement>('codeForm');
const codeInput = $<HTMLInputElement>('codeInput');
const codeError = $('codeError');
const loading = $('loading');
const gallery = $('gallery');
const codeLabel = $('codeLabel');
const stripImg = $<HTMLImageElement>('stripImg');
const gifImg = $<HTMLImageElement>('gifImg');
const allWrap = $('allWrap');
const allImg = $<HTMLImageElement>('allImg');
const shareBtn = $<HTMLButtonElement>('shareBtn');
const picksWrap = $('picksWrap');
const picksGrid = $('picksGrid');
const pickAllBtn = $<HTMLButtonElement>('pickAllBtn');
const savePicksBtn = $<HTMLButtonElement>('savePicksBtn');
const iosHint = $('iosHint');
const downloadLinks: Record<Exclude<AssetKey, 'all'>, HTMLAnchorElement> = {
  sheet: $<HTMLAnchorElement>('dlSheet'),
  story: $<HTMLAnchorElement>('dlStory'),
  gif: $<HTMLAnchorElement>('dlGif'),
};

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

let currentCode = '';
let shareFiles: File[] | null = null;

type PhotoUrl = (n: number, opts?: { width?: number; download?: boolean }) => string;
/** Where the single photos come from for the current code, or null when there are none. */
let photoSrc: PhotoUrl | null = null;
const picked = new Set<number>();
/** Full-size files fetched ahead on phones, so the share sheet can open straight from the tap. */
const photoFiles = new Map<number, File>();
/** On phones, "save" opens the share sheet (Save to Photos); elsewhere it downloads files. */
const useShareSheet = matchMedia('(pointer: coarse)').matches && 'canShare' in navigator;

function setCodeInUrl(code: string | null): void {
  const url = new URL(location.href);
  if (code) url.searchParams.set('s', code);
  else url.searchParams.delete('s');
  history.replaceState(null, '', url);
}

function showForm(message?: string): void {
  gallery.hidden = true;
  loading.hidden = true;
  codeForm.hidden = false;
  codeError.hidden = !message;
  codeError.textContent = message ?? '';
  codeInput.focus();
}

function loadImage(img: HTMLImageElement, src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error(`Failed to load ${src}`));
    img.src = src;
  });
}

async function showGallery(code: string): Promise<void> {
  currentCode = code;
  codeForm.hidden = true;
  gallery.hidden = true;
  loading.hidden = false;

  // The story image is the single strip — nicer on a phone than the 2-up print sheet.
  // Look for it in each account the booth has used, and stay with the one that has it.
  let found = false;
  for (const cloud of CLOUDS) {
    try {
      await loadImage(stripImg, deliveryUrl(cloud, code, 'story'));
      CLOUD_NAME = cloud;
      found = true;
      break;
    } catch {
      if (currentCode !== code) return;
    }
  }
  if (currentCode !== code) return;
  if (!found) {
    setCodeInUrl(null);
    showForm('Foto untuk kode itu tidak ditemukan — cek lagi kodenya.');
    return;
  }

  gifImg.src = deliveryUrl(CLOUD_NAME, code, 'gif');
  // Sessions from before the 8-photo update have no "all" image: just hide that part.
  allWrap.hidden = true;
  loadImage(allImg, deliveryUrl(CLOUD_NAME, code, 'all')).then(
    () => {
      if (currentCode !== code) return;
      allWrap.hidden = false;
    },
    () => {},
  );
  for (const [asset, a] of Object.entries(downloadLinks) as [Exclude<AssetKey, 'all'>, HTMLAnchorElement][]) {
    a.href = attachmentUrl(CLOUD_NAME, code, asset);
  }
  codeLabel.textContent = code;
  iosHint.hidden = !isIOS;
  loading.hidden = true;
  gallery.hidden = false;
  void prepareShare(code);
  void preparePhotos(code);
}

/** Resolves true if the image exists (any size is fine, this only probes). */
function imageExists(src: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = src;
  });
}

/**
 * The "pick your photos" grid. New sessions have each shot uploaded on its own;
 * older ones only have the 8-photo sheet, so the shots are cut out of that.
 */
async function preparePhotos(code: string): Promise<void> {
  photoSrc = null;
  picked.clear();
  photoFiles.clear();
  picksWrap.hidden = true;
  picksGrid.replaceChildren();

  let src: PhotoUrl | null = null;
  if (await imageExists(photoUrl(CLOUD_NAME, code, 1, { width: 40 }))) {
    src = (n, opts) => photoUrl(CLOUD_NAME, code, n, opts);
  } else if (await imageExists(deliveryUrl(CLOUD_NAME, code, 'all'))) {
    src = (n, opts) => croppedPhotoUrl(CLOUD_NAME, code, n, opts);
  }
  if (!src || currentCode !== code) return;
  photoSrc = src;

  for (let n = 1; n <= PHOTO_COUNT; n++) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pick';
    btn.setAttribute('aria-pressed', 'false');
    btn.setAttribute('aria-label', `Foto ${n}`);
    const img = document.createElement('img');
    img.src = src(n, { width: 480 });
    img.alt = '';
    img.loading = 'lazy';
    // A shot that failed to upload just drops out of the grid.
    img.onerror = () => {
      li.remove();
      picked.delete(n);
      updatePickButtons();
    };
    const num = document.createElement('span');
    num.className = 'pick__num';
    num.textContent = String(n);
    const check = document.createElement('span');
    check.className = 'pick__check';
    check.textContent = '✓';
    check.setAttribute('aria-hidden', 'true');
    btn.append(img, num, check);
    btn.addEventListener('click', () => {
      if (picked.has(n)) picked.delete(n);
      else picked.add(n);
      btn.setAttribute('aria-pressed', String(picked.has(n)));
      updatePickButtons();
    });
    li.append(btn);
    picksGrid.append(li);
  }
  updatePickButtons();
  picksWrap.hidden = false;

  if (useShareSheet) {
    for (let n = 1; n <= PHOTO_COUNT; n++) {
      fetch(src(n))
        .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(`HTTP ${res.status}`))))
        .then((blob) => {
          if (currentCode === code) {
            photoFiles.set(n, new File([blob], `dearly-${code}-${n}.jpg`, { type: blob.type || 'image/jpeg' }));
          }
        })
        .catch(() => {});
    }
  }
}

function pickButtons(): HTMLButtonElement[] {
  return [...picksGrid.querySelectorAll<HTMLButtonElement>('.pick')];
}

function updatePickButtons(): void {
  const count = picked.size;
  savePicksBtn.disabled = count === 0;
  savePicksBtn.textContent = count ? `Simpan ${count} foto` : 'Simpan foto';
  const all = pickButtons().length;
  pickAllBtn.textContent = count > 0 && count === all ? 'Batal pilih' : 'Pilih semua';
}

/**
 * Saves the picks one by one as real files. Fetching first keeps the page in
 * place (a plain link to the image could navigate away instead of downloading).
 */
async function downloadPicks(numbers: number[]): Promise<void> {
  const src = photoSrc;
  const code = currentCode;
  if (!src) return;
  savePicksBtn.disabled = true;
  try {
    for (const n of numbers) {
      try {
        const res = await fetch(src(n));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const url = URL.createObjectURL(await res.blob());
        const a = document.createElement('a');
        a.href = url;
        a.download = `dearly-${code}-${n}.jpg`;
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      } catch {
        // Last resort: Cloudinary's own download link for this one photo.
        window.open(src(n, { download: true }), '_blank', 'noopener');
      }
      // Browsers can drop downloads that start in the same instant.
      await new Promise((r) => setTimeout(r, 300));
    }
  } finally {
    updatePickButtons();
  }
}

function savePicks(): void {
  const numbers = [...picked].sort((a, b) => a - b);
  if (!numbers.length) return;
  if (useShareSheet) {
    const files = numbers.map((n) => photoFiles.get(n));
    if (files.every((f): f is File => !!f) && navigator.canShare({ files })) {
      navigator.share({ files, title: 'Foto Dearly Photobooth' }).catch((err: Error) => {
        if (err.name !== 'AbortError') void downloadPicks(numbers);
      });
      return;
    }
  }
  void downloadPicks(numbers);
}

/**
 * Native share sheet (save to Photos / send to IG) on phones. Files are fetched
 * up front: share() must run straight from the tap, with no await before it.
 */
async function prepareShare(code: string): Promise<void> {
  shareFiles = null;
  shareBtn.hidden = true;
  if (!('canShare' in navigator)) return;
  try {
    const files = await Promise.all(
      (['story', 'gif'] as const).map(async (asset) => {
        const res = await fetch(deliveryUrl(CLOUD_NAME, code, asset));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const ext = asset === 'gif' ? 'gif' : 'jpg';
        return new File([blob], `dearly-${code}-${asset}.${ext}`, { type: blob.type });
      }),
    );
    if (currentCode !== code || !navigator.canShare({ files })) return;
    shareFiles = files;
    shareBtn.hidden = false;
  } catch {
    // Sharing is optional; the download links still work.
  }
}

codeForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const code = normalizeSessionCode(codeInput.value);
  if (!code) return;
  if (!isValidSessionCode(code)) {
    showForm('Kode harus 6 karakter (huruf & angka) seperti yang tampil di layar tablet.');
    return;
  }
  setCodeInUrl(code);
  void showGallery(code);
});

shareBtn.addEventListener('click', () => {
  if (!shareFiles) return;
  navigator.share({ files: shareFiles, title: 'Foto Dearly Photobooth' }).catch((err: Error) => {
    if (err.name !== 'AbortError') console.error(err);
  });
});

pickAllBtn.addEventListener('click', () => {
  const buttons = pickButtons();
  const selectAll = picked.size !== buttons.length;
  picked.clear();
  for (const btn of buttons) {
    const n = Number(btn.querySelector('.pick__num')?.textContent);
    if (selectAll) picked.add(n);
    btn.setAttribute('aria-pressed', String(selectAll));
  }
  updatePickButtons();
});

savePicksBtn.addEventListener('click', savePicks);

$('otherCodeBtn').addEventListener('click', () => {
  currentCode = '';
  codeInput.value = '';
  setCodeInUrl(null);
  showForm();
});

const initial = normalizeSessionCode(new URLSearchParams(location.search).get('s') ?? '');
if (isValidSessionCode(initial)) void showGallery(initial);
else showForm(initial ? 'Kode di link tidak valid — masukkan manual.' : undefined);
