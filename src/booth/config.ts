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
    label: 'Bestie',
    prompts: [
      'Pura-pura lagi ngegosipin orang di belakang kamera',
      'Muka pas dosen bilang "ada kuis hari ini"',
      'Peluk yang paling nggak nyaman',
      'Pura-pura nggak kenal satu sama lain',
      'Tos paling heboh',
      'Foto ala album keluarga zaman dulu',
      'Semua jongkok, dagu di tangan',
      'Pose cover album K-pop, semua serius',
      'Satu orang jadi fotografer, sisanya model',
      'Semua sibuk main HP, cuek sama kamera',
      'Pose foto keluarga pas lebaran',
      'Pose "habis berantem tapi udah baikan"',
      'Formasi boyband / girlband',
      'Muka pas temen bilang "otw" padahal baru bangun',
      'Rangkulan kayak tim juara',
      'Pose foto wisuda TK',
      'Satu orang curhat, sisanya pura-pura dengerin',
      'Saling sandaran, capek abis jalan seharian',
      'Pose iklan sampo, kibas rambut',
      'Semua bikin bentuk hati pakai tangan',
      'Senyum paling palsu kalian',
    ],
  },
  COUPLE: {
    label: 'Couple',
    prompts: [
      'Lihat satu sama lain kayak baru ketemu pertama kali',
      'Satu orang ngelucu, satu orang nahan ketawa',
      'Foto yang bakal kalian sesali 5 tahun lagi',
      'Pura-pura berantem soal mau makan di mana',
      'Pose prewedding paling dramatis',
      'Bisikin sesuatu ke telinga pasangan',
      'Bikin bentuk hati pakai tangan berdua',
      'Pose foto KTP berdua',
      'Satu marah, satu minta maaf',
      'Tatap-tatapan, yang ketawa duluan kalah',
      'Adegan drakor di halte bus',
      'Foto anniversary ke-50',
      'Hidung ketemu hidung',
      'Satu bawain tas pasangan, muka pasrah',
      'Pose sampul novel romantis',
      'Rebutan makanan terakhir',
      'Muka pas pasangan bilang "terserah"',
      'Saling benerin rambut',
      'Pose dansa',
      'Back to back kayak poster film action',
      'Satu ngambek, satu bujukin',
      'Foto pacaran pertama yang canggung',
      'Nunggu ojol bareng, dua-duanya bete',
      'Gandengan, lihat jauh ke depan',
    ],
  },
  CHAOS: {
    label: 'Chaos',
    prompts: [
      'Ekspresi paling jelek yang kalian bisa',
      'Pura-pura lagi jatuh',
      'Semua orang lihat arah yang beda',
      'Pura-pura kesetrum',
      'Teriak sekencang-kencangnya, tapi tanpa suara',
      'Jadi patung paling aneh',
      'Satu orang pingsan, sisanya panik',
      'Semua jadi zombie',
      'Kena angin topan',
      'Muka pas WiFi tiba-tiba mati',
      'Dikejar anjing',
      'Jadi hewan pilihan masing-masing',
      'Konser rock, semua headbang',
      'Freeze kayak video nge-lag',
      'Muka paling kaget sedunia',
      'Lagi naik roller coaster',
      'Rebutan jadi paling depan',
      'Kepedesan level 10',
      'Semua pose kungfu',
      'Muka pas ketahuan nyontek',
      'Pose superhero, tapi gagal',
      'Tarik tambang tanpa tali',
      'Kepanasan banget',
      'Muka nempel ke kamera, sedekat mungkin',
    ],
  },
  CORPORATE: {
    label: 'Corporate',
    prompts: [
      'Headshot LinkedIn paling serius',
      'Handshake yang terlalu formal',
      'Pura-pura lagi presentasi ke investor',
      'Pose "profit naik", tangan diagonal ke atas',
      'Muka "meeting ini harusnya cukup lewat email"',
      'Foto tim buat website kantor',
      'Rayain closing deal',
      'Muka pas bos bilang "ada waktu sebentar?"',
      'Pose Employee of the Month',
      'Lagi Zoom, kamera mati, rebahan',
      'Semua pegang dagu, mikir keras',
      'Muka Senin jam 8 pagi',
      'Muka Jumat jam 5 sore',
      'Pose CEO startup di majalah',
      'Satu ngomong serius, sisanya ketiduran',
      'Reaksi pas dapet bonus',
      'Rapat mendadak, semua panik',
      'Pose "kita satu keluarga besar"',
      'Ngetik di keyboard khayalan, serius banget',
      'Tos "teamwork makes the dream work"',
      'Muka pas disuruh lembur',
      'Jalan pergi sambil dadah ke kamera',
      'Salaman sambil buang muka',
      'Foto stok "orang kantor ketawa"',
    ],
  },
  KULIAH: {
    label: 'Anak Kuliahan',
    prompts: [
      'Muka pas lihat nilai keluar',
      'Semua kepal tangan, "semangat!"',
      'Sujud syukur karena akhirnya submit',
      'Ngantuk di kelas jam 7 pagi',
      'Nunggu dosen yang nggak dateng-dateng',
      'Panik, deadline jam 23.59',
      'Lempar toga khayalan',
      'Muka pas dosen bilang "kelompoknya saya yang tentuin"',
      'Satu kerja, sisanya numpang nama',
      'Pose foto KTM',
      'Muka pas sidang skripsi',
      'Rebutan colokan di perpus',
      'Pegang pulpen, bengong ke atas',
      'Lari ngejar kelas yang udah mulai',
      'Muka pas tanggal tua',
      'Sok rajin di perpustakaan',
      'Pose "IPK aman"',
      'Reaksi pas kelas dibatalin',
      'Presentasi tapi lupa materi',
      'Semua angkat tangan mau jawab',
      'Begadang ngerjain tugas, mata panda',
      'Maba hari pertama ospek',
      'Dagu di tangan, nunggu lama banget',
      'Pose wisuda beneran',
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
