import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { BOOK_PRICE, BOOK_PRICE_TAG, DECKS, OFFER_MS, type DeckId } from '../booth/config';
import { FRAME_SETS, frameById, framesInSet, setById, type FrameStyle, type SetId } from '../booth/gacha';
import type { GuestIntent } from '../shared/link-protocol';
import type { GuestView } from '../shared/view';
import { Burst, Confetti, RoughFilter, Star } from '../ui/Decor';
import { useQr } from '../ui/useQr';
import '../ui/brand.css';
import './guest-screen.css';

/** Design size of the guest screen. The Galaxy Tab S8 in landscape is 1280×800 CSS px. */
export const STAGE_W = 1280;
export const STAGE_H = 800;

interface Props {
  view: GuestView;
  /** Live camera picture: a <video> on the Mac, an <img> stream on the tablet. */
  preview: ReactNode;
  onIntent(intent: GuestIntent): void;
}

/**
 * The whole guest-facing screen. Pure: it only draws `view` and reports taps,
 * so the tablet and the Mac mirror render exactly the same thing.
 */
export function GuestScreen({ view, preview, onIntent }: Props) {
  return (
    <div className={`gs ${view.phase === 'idle' ? 'sky-bg' : 'gingham'} gs--${view.phase}`}>
      <RoughFilter />
      {view.phase === 'idle' && <Attract preview={preview} onStart={() => onIntent({ type: 'start' })} />}
      {view.phase === 'set' && <SetPicker chosen={view.set} onIntent={onIntent} />}
      {view.phase === 'deck' && (
        <DeckPicker
          set={view.set}
          onPick={(deck) => onIntent({ type: 'deck', deck })}
          onBack={() => onIntent({ type: 'back' })}
        />
      )}
      {view.phase === 'capturing' && <Capture view={view} preview={preview} />}
      {view.phase === 'select' && <Select view={view} onIntent={onIntent} />}
      {view.phase === 'reveal' && <Reveal view={view} />}
      {view.phase === 'offer' && <BookOffer key={view.offerId} view={view} onIntent={onIntent} />}
      {view.phase === 'result' && <Result view={view} onFinish={() => onIntent({ type: 'finish' })} />}
      {view.preview && <div className="gs-preview-note sticky">Pratinjau desain</div>}
    </div>
  );
}

function frameVars(frame: FrameStyle): CSSProperties {
  return {
    '--f-bg': frame.bg,
    '--f-border': frame.border,
    '--f-ink': frame.ink,
    /** Readable text colour on the frame colour (the outline colour where the lettering is white). */
    '--f-solid': frame.outline ?? frame.ink,
    '--f-pc': frame.patternInk,
  } as CSSProperties;
}

/** Tiny strip with four photo holes, painted in a frame's colours and pattern. */
function MiniStrip({ frame, className = '' }: { frame: FrameStyle; className?: string }) {
  if (frame.art) {
    return <img className={`gs-mini gs-mini--art ${className}`} src={frame.art.thumb} alt="" aria-hidden="true" />;
  }
  return (
    <span className={`gs-mini pat-${frame.pattern} ${className}`} style={frameVars(frame)} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

/** "Dearly" over "Photobooth", as on the title slide. */
function Logo({ className = '' }: { className?: string }) {
  return (
    <div className={`gs-logo ${className}`} role="img" aria-label="Dearly Photobooth">
      <span className="gs-logo__script sticker sticker--script">Dearly</span>
      <span className="gs-logo__word sticker">Photobooth</span>
    </div>
  );
}

/* ---------- Attract ---------- */
function Attract({ preview, onStart }: { preview: ReactNode; onStart(): void }) {
  return (
    <div className="gs-attract" onClick={onStart}>
      <Confetti />
      <Burst size={150} className="gs-attract__burst" />
      <Star size={42} className="gs-attract__star1" />
      <Star size={30} className="gs-attract__star2" />
      <Star size={54} className="gs-attract__star3" />

      <div className="gs-attract__left">
        <Logo />
        <p className="gs-attract__lede paper">Ikutin arahan pose di layar. Frame-nya? Diundi.</p>
        <button type="button" className="gs-attract__cta tag">
          Tap buat mulai
        </button>
      </div>

      <div className="gs-attract__photo">
        <div className="gs-attract__shadow">
          <div className="stamp">
            <div className="gs-attract__live">{preview}</div>
          </div>
        </div>
        <span className="gs-attract__you tag">Ini kamu!</span>
      </div>

      <aside className="gs-odds sticky">
        <p className="gs-odds__title">Pilih set, frame-nya diundi</p>
        <ul>
          {FRAME_SETS.map((set) => (
            <li key={set.id}>
              <b>{set.label}</b>
              <span className="gs-odds__strips">
                {framesInSet(set.id).map((f) => (
                  <MiniStrip key={f.id} frame={f} />
                ))}
              </span>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

/* ---------- Set picker ---------- */
/** "Frame 5" → "5". */
const frameNo = (frame: FrameStyle) => frame.name.replace(/\D+/g, '');

/** One frame in a set card: a little strip with its number badge. */
function SetStrip({ frame, slot, count }: { frame: FrameStyle; slot: number; count: number }) {
  // Fan the strips out like a hand of cards; wider sets fan tighter.
  const off = slot - (count - 1) / 2;
  const step = count > 3 ? 48 : 74;
  const tilt = count > 3 ? 8 : 11;
  const style = {
    ...frameVars(frame),
    transform: `translateX(${off * step}px) translateY(${Math.abs(off) * 8 - 10}px) rotate(${off * tilt}deg)`,
    zIndex: count - Math.round(Math.abs(off)),
  } as CSSProperties;
  if (frame.art) {
    return (
      <span className="gs-setstrip gs-setstrip--art" style={style}>
        <img src={frame.art.thumb} alt="" />
        <em>{frameNo(frame)}</em>
      </span>
    );
  }
  return (
    <span className={`gs-setstrip pat-${frame.pattern}`} style={style}>
      <i />
      <i />
      <i />
      <i />
      <b>Dearly</b>
      <em>{frameNo(frame)}</em>
    </span>
  );
}

function SetPicker({ chosen, onIntent }: { chosen: SetId | null; onIntent(intent: GuestIntent): void }) {
  return (
    <div className="gs-sheet paper gs-sets">
      <Star size={46} className="gs-sets__star1" />
      <Star size={30} className="gs-sets__star2" />
      <Star size={24} className="gs-sets__star3" />
      <button type="button" className="gs-back" onClick={() => onIntent({ type: 'cancel' })}>
        Batal
      </button>
      <h1 className="gs-title sticker gs-sets__title">Pilih set frame-mu</h1>
      <p className="gs-sets__sub">Frame-nya tetap diundi, tapi cuma dari set yang kamu pilih.</p>

      <ul className="gs-sets__cards">
        {FRAME_SETS.map((set) => {
          const frames = framesInSet(set.id);
          const on = chosen === set.id;
          return (
            <li key={set.id}>
              <button
                type="button"
                className={`gs-setcard ${on ? 'is-on' : ''} ${chosen && !on ? 'is-off' : ''}`}
                style={{ '--tint': set.tint } as CSSProperties}
                aria-pressed={on}
                onClick={() => onIntent({ type: 'set', set: set.id })}
              >
                <span className="tape gs-setcard__tape" />
                <span className="gs-setcard__tag tag">{set.label}</span>
                {on && (
                  <span className="gs-setcard__check" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="30" height="30">
                      <path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                )}
                <span className="gs-setcard__fan" aria-hidden="true">
                  {frames.map((f, i) => (
                    <SetStrip key={f.id} frame={f} slot={i} count={frames.length} />
                  ))}
                </span>
                <span className="gs-setcard__foot">
                  <span className="gs-setcard__names">
                    Frame {frameNo(frames[0])}–{frameNo(frames[frames.length - 1])}
                  </span>
                  <span className="gs-setcard__odds">tiap frame 1 dari {frames.length}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="gs-sets__bar">
        <span className="gs-sets__hint sticky">
          {chosen
            ? `Kamu bakal dapet salah satu dari ${framesInSet(chosen).length} frame ${setById(chosen).label}`
            : 'Tap salah satu set dulu ya'}
        </span>
        <button
          type="button"
          className={`gs-sets__go tag ${chosen ? '' : 'is-idle'}`}
          aria-disabled={!chosen}
          onClick={() => chosen && onIntent({ type: 'confirmSet' })}
        >
          {chosen ? `Pakai ${setById(chosen).label}` : 'Pakai set ini'}
        </button>
      </div>
    </div>
  );
}

/* ---------- Deck picker ---------- */
/** Poses previewed on each card; the rest are a surprise. */
const CARD_POSES = 3;

function DeckPicker({ set, onPick, onBack }: { set: SetId | null; onPick(deck: DeckId): void; onBack(): void }) {
  return (
    <div className="gs-sheet paper gs-deck">
      <Star size={46} className="gs-deck__star1" />
      <Star size={30} className="gs-deck__star2" />
      <button type="button" className="gs-back" onClick={onBack}>
        Kembali
      </button>
      {set && <span className="gs-deck__set sticky">{setById(set).label}</span>}
      <h1 className="gs-title sticker">Mau gaya apa?</h1>
      <p className="gs-deck__sub">Pilih satu, nanti tiap foto ada arahan pose-nya.</p>
      <ul className="gs-deck__cards">
        {(Object.keys(DECKS) as DeckId[]).map((id) => (
          <li key={id}>
            <button type="button" className="gs-card" onClick={() => onPick(id)}>
              <span className="gs-card__label">{DECKS[id].label}</span>
              {/* Spans, not a list: buttons may only contain inline content. */}
              <span className="gs-card__poses">
                {DECKS[id].prompts.slice(0, CARD_POSES).map((p) => (
                  <span key={p}>{p}</span>
                ))}
              </span>
              <span className="gs-card__more">+{DECKS[id].prompts.length - CARD_POSES} pose lagi</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- Capture ---------- */
/** Flash only for shots taken after this screen appeared (not on first render). */
function useNewFlash(flashId: number): number | null {
  const first = useRef(flashId);
  return flashId !== first.current ? flashId : null;
}

function Capture({ view, preview }: { view: GuestView; preview: ReactNode }) {
  const flash = useNewFlash(view.flashId);
  return (
    <div className="gs-capture">
      {/* The window is exactly 3:2 — the shape of each photo on the strip. */}
      <div className="gs-capture__window">
        <div className="gs-capture__live">{preview}</div>
        {view.count !== null && (
          <div className="gs-count sticker" key={`${view.shot}-${view.count}`}>
            {view.count}
          </div>
        )}
        {flash !== null && <div className="gs-flash" key={flash} />}
      </div>
      {view.prompt && (
        <div className="gs-prompt" key={view.shot}>
          <span className="gs-prompt__step sticky">
            Foto {Math.min(view.shot + 1, view.totalShots)} dari {view.totalShots}
          </span>
          <p className="tag">{view.prompt}</p>
        </div>
      )}
      <div className="gs-progress paper" aria-label={`Foto ${Math.min(view.shot + 1, view.totalShots)} dari ${view.totalShots}`}>
        {Array.from({ length: view.totalShots }, (_, i) => (
          <Star key={i} size={24} className={i < view.shot ? 'is-done' : i === view.shot ? 'is-now' : ''} />
        ))}
      </div>
    </div>
  );
}

/* ---------- Pick photos ---------- */
function Select({ view, onIntent }: { view: GuestView; onIntent(intent: GuestIntent): void }) {
  const count = view.selected.length;
  const full = count >= view.pickCount;
  const tiles = Array.from({ length: view.totalShots }, (_, i) => i);
  return (
    <div className="gs-sheet paper gs-select">
      <Star size={40} className="gs-select__star" />
      <h1 className="gs-title sticker">Pilih {view.pickCount} foto favoritmu</h1>
      <p className="gs-select__sub">Tap fotonya. Yang kamu pilih masuk ke strip.</p>

      <ul className="gs-select__grid">
        {tiles.map((i) => {
          const on = view.selected.includes(i);
          return (
            <li key={i}>
              <button
                type="button"
                className={`gs-tile ${on ? 'is-on' : ''} ${full && !on ? 'is-muted' : ''}`}
                aria-pressed={on}
                aria-label={`Foto ${i + 1}`}
                onClick={() => onIntent({ type: 'toggle', index: i })}
              >
                {view.thumbs[i] ? (
                  <img src={view.thumbs[i]} alt="" />
                ) : (
                  <span className={`gs-tile__blank gs-tile__blank--${i % 3}`} />
                )}
                <span className="gs-tile__no">{i + 1}</span>
                {on && (
                  <span className="gs-tile__check" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="26" height="26">
                      <path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="gs-select__bar">
        <button type="button" className="gs-upsell sticky" onClick={() => onIntent({ type: 'upgrade' })}>
          <b>Suka semua?</b>
          <span>Ambil versi besar: semua {view.totalShots} foto, dicetak 2 set</span>
        </button>
        <div className="gs-select__go">
          <span className="gs-select__count">
            {count} dari {view.pickCount} dipilih
          </span>
          <button
            type="button"
            className="gs-next"
            aria-disabled={!full}
            onClick={() => full && onIntent({ type: 'confirm' })}
          >
            Lanjut
          </button>
        </div>
      </div>

      {view.upgradePending && (
        <div className="gs-pending">
          <div className="gs-pending__card paper">
            <Star size={44} className="gs-pending__star" />
            <h2 className="sticker">Versi besar!</h2>
            <p>
              Semua {view.totalShots} foto dicetak ukuran kecil, 2 set: buat kamu dan temanmu. Bayar ke kasir
              dulu ya, setelah dikonfirmasi langsung lanjut.
            </p>
            <button type="button" className="gs-pending__back" onClick={() => onIntent({ type: 'cancelUpgrade' })}>
              Nggak jadi, pilih {view.pickCount} aja
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- Gacha reveal ---------- */
function Reveal({ view }: { view: GuestView }) {
  const frame = frameById(view.frame ?? 'f1');
  return (
    <div className="gs-reveal">
      <Burst size={220} className="gs-reveal__burst1" />
      <Burst size={140} className="gs-reveal__burst2" />
      <p className="gs-reveal__rolling sticker sticker--script">Lagi diundi…</p>
      <div className="gs-capsule" aria-hidden="true">
        <span className="gs-capsule__top" />
        <span className="gs-capsule__bottom" />
      </div>
      <div className="gs-reveal__prize">
        <MiniStrip frame={frame} className="gs-mini--prize" />
        <div className="gs-reveal__text">
          <p className="sticker sticker--script">Kamu dapet</p>
          <h1 className="gs-reveal__name sticker" style={frameVars(frame)}>
            {frame.name}
          </h1>
          <p className="gs-reveal__set tag">dari {setById(frame.set).label}</p>
        </div>
      </div>
      <p className="gs-reveal__status paper">{view.busy ? 'Lagi nyiapin fotomu…' : 'Siap!'}</p>
    </div>
  );
}

/* ---------- Book keychain offer ---------- */
/** Whole seconds left, counted locally from when the offer opened. */
function useSecondsLeft(totalMs: number): number {
  const start = useRef(Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  return Math.max(0, Math.ceil((totalMs - (now - start.current)) / 1000));
}

/** Countdown ring; the bar drains in one smooth CSS animation over the whole offer. */
function TimerRing({ size, seconds }: { size: number; seconds: number }) {
  const r = size / 2 - 9;
  const c = 2 * Math.PI * r;
  return (
    <div className="gs-timer" style={{ width: size, height: size }} role="timer" aria-label={`${seconds} detik lagi`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} className="gs-timer__track" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          className="gs-timer__bar"
          strokeDasharray={c}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ '--c': c, animationDuration: `${OFFER_MS}ms` } as CSSProperties}
        />
      </svg>
      <span className="gs-timer__num">{seconds}</span>
      <span className="gs-timer__unit">detik</span>
    </div>
  );
}

/** A photo from the session, or a soft placeholder in design preview. */
function Thumb({ src, i }: { src: string | undefined; i: number }) {
  return src ? <img src={src} alt="" /> : <span className={`gs-tile__blank gs-tile__blank--${i % 3}`} />;
}

/** The little photo book hanging from its key ring. */
function BookKeychain({ view }: { view: GuestView }) {
  const cover = view.selected[0] ?? 0;
  const others = [0, 1, 2, 3, 4, 5, 6, 7].filter((i) => i !== cover);
  return (
    <div className="gs-kc" aria-hidden="true">
      <div className="gs-kc__swing">
        <span className="gs-kc__loose gs-kc__loose--1">
          <Thumb src={view.thumbs[others[2]]} i={1} />
        </span>
        <span className="gs-kc__loose gs-kc__loose--2">
          <Thumb src={view.thumbs[others[5]]} i={2} />
        </span>
        <div className="gs-kc__ring" />
        <div className="gs-kc__chain">
          <i />
          <i />
          <i />
        </div>
        <div className="gs-kc__book">
          <div className="gs-kc__pages" />
          <div className="gs-kc__cover paper">
            <span className="gs-kc__eyelet" />
            <span className="gs-kc__photo">
              <Thumb src={view.thumbs[cover]} i={0} />
            </span>
            <span className="gs-kc__title">Dearly</span>
            <span className="gs-kc__sub">
              {view.totalShots} foto · {view.code}
            </span>
          </div>
        </div>
      </div>
      <div className="gs-kc__price">
        <Burst size={190} className="gs-kc__burst" />
        <span className="gs-kc__price-text sticker">{BOOK_PRICE_TAG}</span>
      </div>
    </div>
  );
}

function BookOffer({ view, onIntent }: { view: GuestView; onIntent(intent: GuestIntent): void }) {
  const seconds = useSecondsLeft(OFFER_MS);
  const total = Math.round(OFFER_MS / 1000);
  return (
    <div className="gs-offer">
      <Star size={40} className="gs-offer__s1" />
      <Star size={26} className="gs-offer__s2" />
      <Star size={34} className="gs-offer__s3" />
      <BookKeychain view={view} />

      <div className="gs-sheet paper gs-offer__card">
        <p className="gs-offer__kicker sticker sticker--script">Satu lagi…</p>
        <h1 className="gs-title sticker gs-offer__title">Mau versi buku?</h1>
        <p className="gs-offer__lede">
          Semua {view.totalShots} fotomu dijadiin <b>buku mini gantungan kunci</b>. Pas buat digantung di tas atau
          kunci motor.
        </p>
        <div className="gs-offer__thumbs" aria-hidden="true">
          {Array.from({ length: view.totalShots }, (_, i) => (
            <span key={i}>
              <Thumb src={view.thumbs[i]} i={i} />
            </span>
          ))}
        </div>
        <div className="gs-offer__row">
          <TimerRing size={132} seconds={seconds} />
          <div className="gs-offer__expire">
            <span className="gs-offer__left">Cuma {total} detik!</span>
            <span className="gs-offer__note">Kalau waktunya habis, penawarannya hilang dan fotomu langsung muncul.</span>
          </div>
        </div>
        <div className="gs-offer__actions">
          <button type="button" className="gs-offer__yes tag" onClick={() => onIntent({ type: 'buyBook' })}>
            Mau, tambah buku!
          </button>
          <button type="button" className="gs-offer__no" onClick={() => onIntent({ type: 'skipBook' })}>
            Nggak dulu
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Result ---------- */
function Result({ view, onFinish }: { view: GuestView; onFinish(): void }) {
  const frame = frameById(view.frame ?? 'f1');
  const qr = useQr(view.link);
  const printing =
    (view.pkg === 'big' ? 'Versi besarmu lagi dicetak' : 'Strip-nya lagi dicetak') +
    (view.book ? `, gantungan kunci bukumu juga. Bayar ${BOOK_PRICE} buat bukunya ke kasir ya.` : '.');
  return (
    <div className={`gs-result ${view.pkg === 'big' ? 'gs-result--big' : ''}`}>
      <div className="gs-result__strip">
        <span className="tape gs-result__tape1" />
        {view.stripThumb ? (
          <img src={view.stripThumb} alt="Strip foto kamu" />
        ) : (
          <MiniStrip frame={frame} className="gs-mini--result" />
        )}
        <span className="tape gs-result__tape2" />
        <Star size={58} className="gs-result__star" />
      </div>

      <div className="gs-sheet paper gs-result__card">
        <h1 className="gs-title sticker">Fotomu jadi!</h1>
        {view.link ? (
          <p className="gs-result__copy">
            {printing} Scan QR ini buat simpan semua {view.totalShots} foto versi digitalnya.
          </p>
        ) : (
          <p className="gs-result__copy">
            {printing} {view.note ?? 'QR belum tersedia.'}
          </p>
        )}
        <div className="gs-result__row">
          {view.link && (
            <div className="gs-result__qr">
              <div className="stamp">{qr ? <img src={qr} alt="QR code ke halaman foto kamu" /> : <span />}</div>
            </div>
          )}
          <div className="gs-result__meta">
            <span className="gs-result__label">Kode kamu</span>
            <span className="tag gs-result__code">{view.code}</span>
            <span className="gs-result__label">Frame</span>
            <span className="gs-result__frame" style={frameVars(frame)}>
              {setById(frame.set).label} · {frame.name}
            </span>
          </div>
        </div>
        <button type="button" className="gs-done" onClick={onFinish}>
          Selesai
        </button>
      </div>
    </div>
  );
}
