import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { BOOK_PRICE_TAG, DECKS, SHOTS, type Deck, type DeckId } from '../booth/config';
import { FRAME_SETS, frameById, framesInSet, setById, type FrameStyle, type SetId } from '../booth/gacha';
import type { GuestIntent } from '../shared/link-protocol';
import type { GuestView } from '../shared/view';
import { Burst, Star } from '../ui/Decor';
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
      {(view.phase === 'select' || view.phase === 'offer' || view.phase === 'result') && <Clock view={view} />}
      {view.preview && <div className="gs-preview-note sticky">Preview</div>}
    </div>
  );
}

/* ---------- Countdown ---------- */
/** Seconds left of the countdown the session started, restarting whenever it does. */
function useCountdown(ms: number | null, id: number): number | null {
  const [left, setLeft] = useState<number | null>(() => (ms === null ? null : Math.ceil(ms / 1000)));
  useEffect(() => {
    if (ms === null) {
      setLeft(null);
      return;
    }
    const end = Date.now() + ms;
    const tick = () => setLeft(Math.max(0, Math.ceil((end - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [ms, id]);
  return left;
}

const CLOCK_LABELS: Partial<Record<GuestView['phase'], string>> = {
  select: 'Time left to pick',
  offer: 'Moving on in',
  result: 'Back to start in',
};

/** Small pill at the bottom of the screen so guests know how long they have. */
function Clock({ view }: { view: GuestView }) {
  const left = useCountdown(view.timerMs, view.timerId);
  if (left === null) return null;
  const time = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  return (
    <span className="gs-clock" role="timer" aria-label={`${left} seconds left`}>
      {CLOCK_LABELS[view.phase]} <b>{time}</b>
    </span>
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

/** The Dearly Photobooth lockup. */
function Logo({ className = '' }: { className?: string }) {
  return <img className={`gs-logo ${className}`} src="/dearly-logo.png" alt="Dearly Photobooth" draggable={false} />;
}

/* ---------- Attract ---------- */
function Attract({ preview, onStart }: { preview: ReactNode; onStart(): void }) {
  return (
    <div className="gs-attract" onClick={onStart}>
      <Floaters />

      <div className="gs-attract__stage">
        <div className="gs-attract__left">
          <Logo />
          <p className="gs-attract__lede">Strike a pose, we’ll pick your frame!</p>
          <div className="gs-attract__ctawrap">
            <button type="button" className="gs-attract__cta">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V10" />
                <path d="M12 10V9a1.5 1.5 0 0 1 3 0v1.5" />
                <path d="M15 10.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.2a6 6 0 0 1-4.7-2.3L4 15.5a1.6 1.6 0 0 1 2.5-2L9 16" />
              </svg>
              Tap to start
            </button>
          </div>
        </div>

        <div className="gs-attract__right">
          <div className="gs-attract__photo">
            <div className="gs-attract__shadow">
              <div className="stamp">
                <div className="gs-attract__live">
                  {preview}
                  <span className="gs-attract__livetag">
                    <i />
                    LIVE
                  </span>
                </div>
              </div>
            </div>
            <span className="gs-attract__you tag">Get ready!</span>
          </div>

          <aside className="gs-odds sticky">
            <span className="tape gs-odds__tape" />
            <p className="gs-odds__title">Frames you might get</p>
            <ul>
              {FRAME_SETS.map((set) => (
                <li key={set.id}>
                  <b className="gs-odds__set tag">{set.label}</b>
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
      </div>

      <div className="gs-attract__ribbon gingham">
        <span>with love, Dearly</span>
      </div>
    </div>
  );
}

/* Four-point sparkles twinkling in the empty blue: mostly cream, just a few red. */
const SPARKLES = [
  { left: 44, top: 120, size: 30, delay: 0, dur: 3.2, red: false },
  { left: 596, top: 70, size: 36, delay: 1.2, dur: 3.8, red: false },
  { left: 376, top: 30, size: 22, delay: 0.5, dur: 2.8, red: false },
  { left: 820, top: 34, size: 24, delay: 1.8, dur: 3.4, red: false },
  { left: 1190, top: 60, size: 44, delay: 0.3, dur: 3.6, red: true },
  { left: 1232, top: 230, size: 26, delay: 2.1, dur: 3.0, red: false },
  { left: 1226, top: 440, size: 34, delay: 1, dur: 3.9, red: false },
  { left: 600, top: 440, size: 30, delay: 0.8, dur: 3.1, red: false },
  { left: 598, top: 570, size: 24, delay: 1.5, dur: 2.9, red: false },
  { left: 60, top: 600, size: 34, delay: 0.6, dur: 3.7, red: true },
  { left: 330, top: 640, size: 26, delay: 1.9, dur: 3.3, red: false },
  { left: 560, top: 650, size: 32, delay: 0.2, dur: 4.0, red: false },
  { left: 960, top: 652, size: 26, delay: 1.4, dur: 2.7, red: false },
  { left: 1160, top: 640, size: 36, delay: 2.4, dur: 3.5, red: true },
  { left: 230, top: 590, size: 20, delay: 1.1, dur: 3.2, red: false },
];

function Floaters() {
  return (
    <div className="gs-float" aria-hidden="true">
      {SPARKLES.map((s, i) => (
        <svg
          key={`k${i}`}
          className={`gs-float__spark ${s.red ? 'is-red' : ''}`}
          width={s.size}
          height={s.size}
          viewBox="0 0 24 24"
          style={{ left: s.left, top: s.top, animationDelay: `${s.delay}s`, animationDuration: `${s.dur}s` }}
        >
          <path d="M12 0C12.8 7.2 16.8 11.2 24 12C16.8 12.8 12.8 16.8 12 24C11.2 16.8 7.2 12.8 0 12C7.2 11.2 11.2 7.2 12 0Z" />
        </svg>
      ))}
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
  const step = count > 3 ? 70 : 96;
  const tilt = count > 3 ? 7 : 10;
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
        Cancel
      </button>
      <h1 className="gs-title sticker gs-sets__title">Pick a set!</h1>
      <p className="gs-sets__sub">Frame’s a surprise, we pick one for you.</p>

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
                  <span className="gs-setcard__odds">1 of {frames.length}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="gs-sets__bar">
        <span className="gs-sets__hint sticky">
          {chosen
            ? `You’ll get 1 of the ${framesInSet(chosen).length} ${setById(chosen).label} frames`
            : 'Choose a set.'}
        </span>
        <button
          type="button"
          className={`gs-sets__go tag ${chosen ? '' : 'is-idle'}`}
          aria-disabled={!chosen}
          onClick={() => chosen && onIntent({ type: 'confirmSet' })}
        >
          {chosen ? `Choose ${setById(chosen).label}` : 'Choose a set'}
        </button>
      </div>
    </div>
  );
}

/* ---------- Deck picker ---------- */
/** Poses previewed on each card; the rest are a surprise. */
const CARD_POSES = 3;
/** Poses per session that come from the pool (the last shot is always "Bebas"). */
const DRAWN = SHOTS - 1;

/** A few sample prompts per gaya, picked fresh each time the screen opens. */
function useSamples(): Record<DeckId, string[]> {
  return useMemo(() => {
    const out = {} as Record<DeckId, string[]>;
    for (const id of Object.keys(DECKS) as DeckId[]) {
      const pool = [...DECKS[id].prompts];
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      out[id] = pool.slice(0, CARD_POSES);
    }
    return out;
  }, []);
}

function DeckPicker({ set, onPick, onBack }: { set: SetId | null; onPick(deck: DeckId): void; onBack(): void }) {
  const samples = useSamples();
  return (
    <div className="gs-sheet paper gs-deck">
      <Star size={46} className="gs-deck__star1" />
      <Star size={30} className="gs-deck__star2" />
      <button type="button" className="gs-back" onClick={onBack}>
        Back
      </button>
      {set && <span className="gs-deck__set sticky">{setById(set).label}</span>}
      <h1 className="gs-title sticker">Pick your style</h1>
      <p className="gs-deck__sub">Pick one, every shot comes with a pose prompt.</p>
      <ul className="gs-deck__cards">
        {(Object.keys(DECKS) as DeckId[]).map((id) => {
          const deck: Deck = DECKS[id];
          return (
            <li key={id}>
              <button type="button" className={`gs-card ${deck.free ? 'gs-card--free' : ''}`} onClick={() => onPick(id)}>
                <span className="gs-card__label">{deck.label}</span>
                {/* Spans, not a list: buttons may only contain inline content. */}
                {deck.free ? (
                  <span className="gs-card__poses gs-card__poses--free">
                    {(deck.blurb ?? []).map((line) => (
                      <span key={line}>{line}</span>
                    ))}
                  </span>
                ) : (
                  <span className="gs-card__poses">
                    {samples[id].map((p) => (
                      <span key={p}>{p}</span>
                    ))}
                  </span>
                )}
                <span className="gs-card__more">
                  {deck.free ? 'You’re in charge' : `${DRAWN} random poses out of ${deck.prompts.length}`}
                </span>
              </button>
            </li>
          );
        })}
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
            Photo {Math.min(view.shot + 1, view.totalShots)} of {view.totalShots}
          </span>
          <p className="tag">{view.prompt}</p>
        </div>
      )}
      <div className="gs-progress paper" aria-label={`Photo ${Math.min(view.shot + 1, view.totalShots)} of ${view.totalShots}`}>
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
      <h1 className="gs-title sticker">Pick your {view.pickCount} favorite photos</h1>
      <p className="gs-select__sub">Tap a photo to add it to your strip.</p>

      <ul className="gs-select__grid">
        {tiles.map((i) => {
          const on = view.selected.includes(i);
          return (
            <li key={i}>
              <button
                type="button"
                className={`gs-tile ${on ? 'is-on' : ''} ${full && !on ? 'is-muted' : ''}`}
                aria-pressed={on}
                aria-label={`Photo ${i + 1}`}
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
        <div className="gs-select__go">
          <span className="gs-select__count">
            {count} of {view.pickCount} picked
          </span>
          <button
            type="button"
            className="gs-next"
            aria-disabled={!full}
            onClick={() => full && onIntent({ type: 'confirm' })}
          >
            Next
          </button>
        </div>
      </div>

      {view.upgradePending && (
        <div className="gs-pending">
          <div className="gs-pending__card paper">
            <Star size={44} className="gs-pending__star" />
            <h2 className="sticker">Big version!</h2>
            <p>
              All {view.totalShots} photos printed small, in 2 sets: one for you and one for a friend. Pay at the
              cashier first, and we’ll continue once it’s confirmed.
            </p>
            <button type="button" className="gs-pending__back" onClick={() => onIntent({ type: 'cancelUpgrade' })}>
              Never mind, just pick {view.pickCount}
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
      <p className="gs-reveal__rolling sticker">Rolling…</p>
      <div className="gs-capsule" aria-hidden="true">
        <span className="gs-capsule__top" />
        <span className="gs-capsule__bottom" />
      </div>
      <div className="gs-reveal__prize">
        <MiniStrip frame={frame} className="gs-mini--prize" />
        <div className="gs-reveal__text">
          <p className="sticker">You got</p>
          <h1 className="gs-reveal__name sticker" style={frameVars(frame)}>
            {frame.name}
          </h1>
          <p className="gs-reveal__set tag">from {setById(frame.set).label}</p>
        </div>
      </div>
      <p className="gs-reveal__status paper">{view.busy ? 'Getting your photos ready…' : 'Almost there…'}</p>
    </div>
  );
}

/* ---------- Book keychain offer ---------- */
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
            {/* Same hand lettering as the frame footers: small "with love," over a big "Dearly". */}
            <span className="gs-kc__sign">
              <span className="gs-kc__with">with love,</span>
              <span className="gs-kc__title">Dearly</span>
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
  return (
    <div className="gs-offer">
      <Star size={40} className="gs-offer__s1" />
      <Star size={26} className="gs-offer__s2" />
      <Star size={34} className="gs-offer__s3" />
      <BookKeychain view={view} />

      <div className="gs-sheet paper gs-offer__card">
        <p className="gs-offer__kicker">One more thing…</p>
        <h1 className="gs-title sticker gs-offer__title">Want a mini book?</h1>
        <p className="gs-offer__lede">
          All {view.totalShots} of your photos turned into a <b>mini keychain book</b>. Perfect for hanging on your
          bag or keys.
        </p>
        <div className="gs-offer__thumbs" aria-hidden="true">
          {Array.from({ length: view.totalShots }, (_, i) => (
            <span key={i}>
              <Thumb src={view.thumbs[i]} i={i} />
            </span>
          ))}
        </div>
        <div className="gs-offer__actions">
          <div className="gs-offer__buy" aria-hidden="true">
            <div className="gs-offer__yes tag">
              1 book
              <small>15K</small>
            </div>
            <div className="gs-offer__yes gs-offer__yes--deal tag">
              2 books
              <small>25K · save 5K</small>
            </div>
          </div>
          <p className="gs-offer__left">Want one? Just tell our crew and pay at the cashier.</p>
          <button type="button" className="gs-next" onClick={() => onIntent({ type: 'nextFromOffer' })}>
            Next
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
  const printing = view.pkg === 'big' ? 'Your big version is printing.' : 'Your strip is printing.';
  return (
    <div className={`gs-result ${view.pkg === 'big' ? 'gs-result--big' : ''}`}>
      <div className="gs-result__strip">
        <span className="tape gs-result__tape1" />
        {view.stripThumb ? (
          <img src={view.stripThumb} alt="Your photo strip" />
        ) : (
          <MiniStrip frame={frame} className="gs-mini--result" />
        )}
        <span className="tape gs-result__tape2" />
        <Star size={58} className="gs-result__star" />
      </div>

      <div className="gs-sheet paper gs-result__card">
        <h1 className="gs-title sticker">Your photos are ready!</h1>
        {view.link ? (
          <p className="gs-result__copy">
            {printing} Scan this QR to save all {view.totalShots} photos in digital.
          </p>
        ) : (
          <p className="gs-result__copy">
            {printing} {view.note ?? 'QR not available yet.'}
          </p>
        )}
        <div className="gs-result__row">
          {view.link && (
            <div className="gs-result__qr">
              <div className="stamp">{qr ? <img src={qr} alt="QR code to your photo page" /> : <span />}</div>
            </div>
          )}
          <div className="gs-result__meta">
            <span className="gs-result__label">Your code</span>
            <span className="tag gs-result__code">{view.code}</span>
            <span className="gs-result__label">Frame</span>
            <span className="gs-result__frame" style={frameVars(frame)}>
              {setById(frame.set).label} · {frame.name}
            </span>
          </div>
        </div>
        <button type="button" className="gs-done" onClick={onFinish}>
          Done
        </button>
      </div>
    </div>
  );
}