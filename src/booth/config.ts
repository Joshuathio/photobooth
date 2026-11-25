/**
 * Print geometry.
 * 4x6" sheet at 300dpi = 1200 x 1800 px; one 2x6" strip = 600 x 1800 px.
 * Two identical strips per sheet — the printer cuts down the middle.
 */
export const SHEET_W = 1200;
export const SHEET_H = 1800;
export const STRIP_W = 600;
// Matches the designers' frame template (frame PNGs with transparent photo holes).
export const MARGIN_X = 40;
export const MARGIN_TOP = 43;
export const GAP = 37;
export const CELL_W = 520;
export const CELL_H = 340;
/** Photos taken per session. */
export const SHOTS = 8;
/** Photos the guest picks for the strip. */
export const STRIP_SHOTS = 4;
export const FOOTER_Y = MARGIN_TOP + STRIP_SHOTS * CELL_H + (STRIP_SHOTS - 1) * GAP; // 1514

/**
 * Big print: 16 landscape cells of 3.5 × 2.55 cm (414 × 300 px), edge to edge.
 * It is laid out on a landscape 6x4" canvas (1800 × 1200) as two identical
 * halves, top and bottom: 4 columns × 2 rows of the 8 photos each, with the
 * logo and code in a narrow footer on the right. For printing the canvas is
 * turned 90°, so the printer's 2x6 cut runs between the two halves.
 */
export const BIG_W = 1800;
export const BIG_H = 1200;
export const BIG_COLS = 4;
export const BIG_ROWS = 2; // per half
export const BIG_CELL_W = 414;
export const BIG_CELL_H = 300;
export const BIG_FOOTER_X = BIG_COLS * BIG_CELL_W; // 1656

/**
 * Legacy digital "all photos" grid: 8 landscape photos, 2 columns × 4 rows. Not made any more,
 * but old sessions still have it, so the gallery cuts their photos out with these numbers.
 */
export const ALL_COLS = 2;
export const ALL_MARGIN = 36;
export const ALL_GAP = 18;
export const ALL_CELL_W = 555;
export const ALL_CELL_H = 370;
export const ALL_FOOTER_Y = ALL_MARGIN + 4 * ALL_CELL_H + 3 * ALL_GAP; // 1570

/** 9:16 version, ready to post straight to a story. */
export const STORY_W = 1080;
export const STORY_H = 1920;

export const GIF_W = 480;
export const GIF_H = 320;
export const GIF_FRAME_MS = 420;

export const COUNTDOWN_FROM = 3;
// Shorter than before so 8 shots still fit in about 42 seconds.
export const PROMPT_MS = 1800;
export const AFTER_SHOT_MS = 500;

/** Dearly brand colours (from the Venture Creation deck), for canvas drawing. */
export const COLORS = {
  red: '#9E2A2B',
  cream: '#EFE8DF',
  sky: '#D6E2F3',
  check: 'rgba(84, 127, 204, 0.44)',
  shadow: 'rgba(34, 52, 92, 0.35)',
} as const;

/** Bundled fonts (see src/ui/brand.css). Canvas needs them loaded first: see ensureFonts(). */
export const FONTS = {
  body: '"Darumadrop One", system-ui, sans-serif',
  chunky: '"Darumadrop One", system-ui, sans-serif',
  script: '"Beth Ellen", cursive',
} as const;

export interface Deck {
  label: string;
  /**
   * The prompt pool (any size of at least SHOTS - 1). Each session draws SHOTS - 1 of them at random (see
   * PromptBag) and ends on LAST_PROMPT. A `free` deck has no pool: its
   * prompts are light cues shown in order, one per shot.
   */
  prompts: readonly string[];
  free?: boolean;
  /** Card text instead of sample prompts (free decks). */
  blurb?: readonly string[];
}

/** The last shot of every session: their own pose. */
export const LAST_PROMPT = 'Bebas — pose andalan kalian';

export const DECKS = {
  BESTIE: {
    label: 'Friends',
    prompts: [
      'Peluk ramean, dempet-dempetan',
      'Pura-pura saling nggak kenal',
      'Ngegosip diem-diem',
      'Sedih bareng, pura-pura nangis',
      'Pura-pura berantem',
      'Kaget lihat sesuatu di belakang kamera',
      'Pura-pura nyari seseorang di kejauhan',
      'Act nonchalant',
      'Ketawa selepasnya',
      'Muka nempel kamera',
      'Muka paling jelek yang kalian bisa',
      'Pusing denger cerita yang sama berulang kali',
      'Melet bareng',
      'Muka pas temen bilang "otw", padahal baru bangun',
      'Semua lihat arah yang beda',
    ],
  },
  COUPLE: {
    label: 'Couple',
    prompts: [
      'Saling rangkul',
      'Capek banget abis begadang berdua',
      'Kembaran, pose sama persis',
      'Bikin hati berdua pakai tangan',
      'Sok jaim berdua',
      'Sandar kepala ke bahu',
      'Saling cubit pipi',
      'Muka jutek bareng',
      'Muka pas dia bilang "terserah"',
      'Muka deket kamera',
      'Ketawa bareng',
      'First date',
      'Salting',
      'Kompak sok misterius',
      'Satu ngambek, satu bujukin',
    ],
  },
  KULIAH: {
    label: 'Uni Life',
    prompts: [
      'Muka pas lihat nilai keluar',
      'Kepal tangan bareng, "semangat!"',
      'Ngantuk di kelas jam 7 pagi',
      'Stres ngerjain final project',
      'Panik, deadline jam 23.59',
      'Lega banget abis submit final project',
      'Muka pas dosen: "kelompok saya yang tentuin"',
      'Udah sampai kampus, tiba-tiba KP',
      'First day FYP, masih semangat',
      'Nilai keluar, ternyata dapat A',
      'Pura-pura paham padahal nggak ngerti materi',
      'Semua angkat tangan, mau jawab',
      'Begadang ngerjain tugas, mata panda',
      'Ketemu dosen di lorong, pura-pura sibuk',
      'Presentasi, tapi lupa materi',
    ],
  },
  MEMES: {
    label: 'Memes',
    // The prompts are only keys for the reference photos (MEME_IMAGES); guests see MEME_CAPTION.
    blurb: ['Ikutin fotonya!'],
    prompts: [
      'meme-01',
      'meme-02',
      'meme-03',
      'meme-04',
      'meme-05',
      'meme-06',
      'meme-07',
      'meme-08',
      'meme-09',
      'meme-10',
      'meme-11',
      'meme-12',
      'meme-13',
      'meme-14',
      'meme-15',
    ],
  },
  BEBAS: {
    label: 'Bebas',
    free: true,
    blurb: ['Tanpa arahan pose', 'Gaya kalian sendiri, 8 kali', 'Cocok buat yang udah punya ide'],
    // Light cues only, no instructions: one per shot, in order.
    prompts: [
      'Bebas! Gaya andalan kalian',
      'Ganti pose!',
      'Satu lagi, beda gaya',
      'Yang lebih heboh',
      'Sekarang yang kalem',
      'Pose favorit kalian',
      'Yang paling "kalian banget"',
      'Terakhir, bebas sebebas-bebasnya!',
    ],
  },
} as const satisfies Record<string, Deck>;

export type DeckId = keyof typeof DECKS;

/** What the capture screen says for every Memes shot, in place of the prompt key. */
export const MEME_CAPTION = 'Ikutin fotonya!';

/** Reference photo shown on the capture screen for each Memes prompt (files in public/). */
export const MEME_IMAGES: Readonly<Record<string, string>> = {
  'meme-01': '/meme-01.jpg',
  'meme-02': '/meme-02.jpg',
  'meme-03': '/meme-03.jpg',
  'meme-04': '/meme-04.jpg',
  'meme-05': '/meme-05.jpg',
  'meme-06': '/meme-06.jpg',
  'meme-07': '/meme-07.jpg',
  'meme-08': '/meme-08.jpg',
  'meme-09': '/meme-09.jpg',
  'meme-10': '/meme-10.jpg',
  'meme-11': '/meme-11.jpg',
  'meme-12': '/meme-12.jpg',
  'meme-13': '/meme-13.jpg',
  'meme-14': '/meme-14.jpg',
  'meme-15': '/meme-15.jpg',
};

/** Session timing beyond the capture loop. */
export const DECK_TIMEOUT_MS = 60_000; // nobody picks a deck → back to the attract screen
export const SELECT_TIMEOUT_MS = 60_000; // nobody picks → the first photos are used (also ends an unanswered upgrade request)
/** Retakes per session from the select screen, each with the shot's own prompt. The operator can add more. */
export const MAX_RETAKES = 3;
/** After a retake the guest picks the old or the new photo; nobody taps → the new one is kept. */
export const RETAKE_CHOOSE_MS = 10_000;
/** Width of the two photos on the "Which one?" screen after a retake (they're shown ~550 px wide). */
export const COMPARE_THUMB_W = 720;
export const REVEAL_MS = 3_400; // minimum time the gacha reveal stays on screen
export const OFFER_MS = 60_000; // book info screen: guests tap Next; this only frees the booth if they walk away
export const RESULT_MS = 90_000; // result + QR screen (the guest's only look at the session code), then back to attract

/** Book keychain upsell: all 8 photos as a mini book on a key ring. */
export const BOOK_PRICE = '15rb';
export const BOOK_PRICE_TAG = '+15K';
