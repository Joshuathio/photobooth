import {
  AFTER_SHOT_MS,
  COMPARE_THUMB_W,
  COUNTDOWN_FROM,
  DECK_TIMEOUT_MS,
  DECKS,
  MAX_RETAKES,
  OFFER_MS,
  PROMPT_MS,
  RESULT_MS,
  RETAKE_CHOOSE_MS,
  REVEAL_MS,
  SELECT_TIMEOUT_MS,
  SHOTS,
  STRIP_SHOTS,
  type DeckId,
} from './config';
import { fixedFrame, framesInSet, isSetId, roll, setById, type FrameId, type FrameStyle, type SetId } from './gacha';
import { PromptBag } from './prompts';
import { Cancelled, sleep as realSleep } from './timing';
import type { GuestIntent } from '../shared/link-protocol';
import { IDLE_VIEW, type GuestView, type PrintPackage } from '../shared/view';

export interface DeliverInput<Shot> {
  code: string;
  /** Every shot taken, in order. */
  shots: Shot[];
  /** Indexes of the shots on the strip (standard) or all of them (big). */
  chosen: number[];
  pkg: PrintPackage;
  frame: FrameId;
}

export interface DeliverResult {
  link: string | null;
  stripThumb: string | null;
}

/** The book keychain file: every shot, in the frame the guest rolled. */
export interface BookInput<Shot> {
  code: string;
  shots: Shot[];
  frame: FrameId;
}

/** Everything the session needs from the outside world, injected so it can be tested. */
export interface SessionDeps<Shot> {
  grab(): Shot;
  /** Small preview of a shot for the selection screen (a JPEG data URL). */
  /** Small JPEG data URL of a shot; `width` defaults to the select grid's size. */
  thumb(shot: Shot, width?: number): string;
  deliver(input: DeliverInput<Shot>): Promise<DeliverResult>;
  newCode(): string;
  random(): number;
  log(text: string, level?: 'info' | 'ok' | 'err'): void;
  sleep?(ms: number, signal: AbortSignal): Promise<void>;
}

const ALL_SHOTS = Array.from({ length: SHOTS }, (_, i) => i);

/**
 * The booth flow as a small state machine:
 * idle → set → deck → capturing → select → reveal → offer → result → idle.
 * From select, a retake goes capturing (one shot) → select again.
 * Both the Mac console and the tablet just render `view`.
 */
export class BoothSession<Shot = unknown> {
  private current: GuestView = IDLE_VIEW;
  private phaseCtl = new AbortController();
  private run = 0;
  /** The session waiting on the selection screen. */
  private taken: { code: string; shots: Shot[]; plan: string[]; run: number } | null = null;
  /** A retaken photo waiting for the guest to pick it or keep the old one. */
  private pendingRetake: { index: number; shot: Shot } | null = null;
  /** Deals each session's poses so back-to-back groups get different ones. */
  private readonly promptBag: PromptBag;
  /** The finished session on the book info screen, until the result screen opens. */
  private offering: { run: number; result: DeliverResult } | null = null;
  private readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;

  constructor(
    private readonly deps: SessionDeps<Shot>,
    private readonly onChange: (view: GuestView) => void,
  ) {
    this.sleep = deps.sleep ?? realSleep;
    this.promptBag = new PromptBag(() => deps.random());
  }

  get view(): GuestView {
    return this.current;
  }

  private set(patch: Partial<GuestView>): void {
    this.current = { ...this.current, ...patch };
    this.onChange(this.current);
  }

  /** Cancels timers and anything in flight for the current phase. */
  private nextPhase(): AbortSignal {
    this.phaseCtl.abort();
    this.phaseCtl = new AbortController();
    return this.phaseCtl.signal;
  }

  /** Runs `then` after `ms` unless the phase changes first. */
  private after(ms: number, signal: AbortSignal, then: () => void): void {
    this.sleep(ms, signal).then(then, () => {});
  }

  /** Attract screen → set picker. */
  begin(): void {
    if (this.current.phase !== 'idle') return;
    this.current = { ...IDLE_VIEW, flashId: this.current.flashId };
    this.showPicker('set');
  }

  /** Set or pose picker, with a timeout back to the attract screen if nobody taps. */
  private showPicker(phase: 'set' | 'deck'): void {
    const signal = this.nextPhase();
    this.set({ phase });
    this.after(DECK_TIMEOUT_MS, signal, () => {
      this.deps.log(`Tidak ada yang pilih ${phase === 'set' ? 'set' : 'gaya'} — kembali ke layar awal`);
      this.reset();
    });
  }

  /**
   * Highlight a set on the set screen. The guest still has to confirm it.
   * A set with no gacha (BINUS) comes with its photo count: 3 or 4.
   */
  pickSet(set: SetId, photos?: number): void {
    if (this.current.phase !== 'set' || !isSetId(set)) return;
    if (setById(set).fixed) {
      const counts: number[] = framesInSet(set).map((f) => f.photos ?? STRIP_SHOTS);
      const count = photos !== undefined && counts.includes(photos) ? photos : Math.max(...counts);
      this.set({ set, pickCount: count });
    } else {
      this.set({ set, pickCount: STRIP_SHOTS });
    }
  }

  /** Highlighted set → pose picker. */
  confirmSet(): void {
    if (this.current.phase !== 'set' || !this.current.set) return;
    this.showPicker('deck');
  }

  /** Pose picker → back to the set screen, keeping the set highlighted. */
  backToSet(): void {
    if (this.current.phase !== 'deck') return;
    this.showPicker('set');
  }

  /** Deck picked → take the photos, then show the selection screen. */
  chooseDeck(deck: DeckId): Promise<void> {
    if (this.current.phase !== 'deck') return Promise.resolve();
    return this.capture(deck);
  }

  /**
   * Mac shortcut (Space): start, then confirm the set (Set A if none is
   * highlighted), then pick the default deck.
   */
  quickStart(defaultDeck: DeckId): void {
    switch (this.current.phase) {
      case 'idle':
        this.begin();
        break;
      case 'set':
        if (!this.current.set) this.pickSet('A');
        this.confirmSet();
        break;
      case 'deck':
        void this.chooseDeck(defaultDeck);
        break;
    }
  }

  handleIntent(intent: GuestIntent, defaultDeck: DeckId): void {
    switch (intent.type) {
      case 'start':
        this.begin();
        break;
      case 'set':
        this.pickSet(intent.set, intent.photos);
        break;
      case 'confirmSet':
        this.confirmSet();
        break;
      case 'deck':
        void this.chooseDeck(DECKS[intent.deck] ? intent.deck : defaultDeck);
        break;
      case 'back':
        this.backToSet();
        break;
      case 'cancel':
        if (this.current.phase === 'set' || this.current.phase === 'deck') this.reset();
        break;
      case 'toggle':
        this.toggle(intent.index);
        break;
      case 'retake':
        void this.retake(intent.index);
        break;
      case 'keepRetake':
        this.keepRetake(intent.use === 'old' ? 'old' : 'new');
        break;
      case 'confirm':
        void this.confirm();
        break;
      case 'upgrade':
        this.requestUpgrade();
        break;
      case 'cancelUpgrade':
        this.declineUpgrade();
        break;
      case 'nextFromOffer':
        this.nextFromOffer();
        break;
      case 'finish':
        if (this.current.phase === 'result') this.reset();
        break;
    }
  }

  /** Operator reset: works in every phase. Delivery keeps running in the background. */
  reset(): void {
    this.nextPhase();
    this.run++;
    this.taken = null;
    this.pendingRetake = null;
    this.offering = null;
    this.current = { ...IDLE_VIEW, flashId: this.current.flashId };
    this.onChange(this.current);
  }

  /* ---------- Selection ---------- */

  toggle(index: number): void {
    const v = this.current;
    if (v.phase !== 'select' || v.upgradePending || v.compare || !Number.isInteger(index)) return;
    if (index < 0 || index >= SHOTS) return;
    if (v.selected.includes(index)) {
      this.set({ selected: v.selected.filter((i) => i !== index) });
    } else if (v.selected.length < v.pickCount) {
      this.set({ selected: [...v.selected, index].sort((a, b) => a - b) });
    }
  }

  /** Guest is done picking. Only works with exactly pickCount photos chosen (4, or 3/4 for BINUS). */
  confirm(): Promise<void> {
    const v = this.current;
    if (v.phase !== 'select' || v.upgradePending || v.compare || v.selected.length !== v.pickCount) {
      return Promise.resolve();
    }
    return this.finish('standard', v.selected);
  }

  /** Guest wants the big print. Waits for the operator to confirm payment. */
  requestUpgrade(): void {
    if (this.current.phase !== 'select' || this.current.upgradePending || this.current.compare) return;
    // The BINUS frame is its own sheet; the big print is for the gacha sets.
    if (this.current.set && setById(this.current.set).fixed) return;
    this.armSelectTimeout(); // the request lapses if the operator doesn't answer in time
    this.deps.log('Tamu minta versi besar — konfirmasi pembayaran di Mac', 'ok');
    this.set({ upgradePending: true });
  }

  /** Operator: payment received, print all photos on the big sheet. */
  approveUpgrade(): Promise<void> {
    if (this.current.phase !== 'select') return Promise.resolve();
    this.deps.log('Versi besar dikonfirmasi');
    return this.finish('big', ALL_SHOTS);
  }

  /** Operator declined, or the guest changed their mind: back to picking 4. */
  declineUpgrade(): void {
    if (this.current.phase !== 'select' || !this.current.upgradePending) return;
    this.set({ upgradePending: false });
    this.armSelectTimeout();
  }

  /* ---------- Retake ---------- */

  /**
   * Retake one photo from the select screen with the same prompt and countdown.
   * The new photo then waits for the guest to keep it or the old one.
   */
  async retake(index: number): Promise<void> {
    const v = this.current;
    const taken = this.taken;
    if (v.phase !== 'select' || v.upgradePending || v.compare || !taken) return;
    if (!Number.isInteger(index) || index < 0 || index >= SHOTS || v.retakesLeft <= 0) return;
    const signal = this.nextPhase();
    const run = this.run;
    this.deps.log(`Ulang foto ${index + 1} (sisa ulang ${v.retakesLeft - 1})`);
    this.set({
      phase: 'capturing',
      retakesLeft: v.retakesLeft - 1,
      retakeOf: index,
      shot: index,
      prompt: taken.plan[index] ?? null,
      count: null,
      freshShot: null,
      timerMs: null,
      timerId: v.timerId + 1,
    });

    let shot: Shot;
    try {
      await this.sleep(PROMPT_MS, signal);
      for (let n = COUNTDOWN_FROM; n > 0; n--) {
        this.set({ count: n });
        await this.sleep(1000, signal);
      }
      shot = this.deps.grab();
      this.set({ count: null, flashId: this.current.flashId + 1 });
      await this.sleep(AFTER_SHOT_MS, signal);
    } catch (err) {
      if (err instanceof Cancelled || run !== this.run) return;
      // Camera hiccup: give the retake back and return to picking.
      this.deps.log(`Gagal ulang foto: ${err instanceof Error ? err.message : String(err)}`, 'err');
      this.backToSelect({ retakesLeft: this.current.retakesLeft + 1 });
      this.armSelectTimeout();
      return;
    }
    if (run !== this.run || this.taken !== taken) return;

    this.pendingRetake = { index, shot };
    // The compare screen shows both photos big, so they get bigger thumbnails than the grid.
    const old = taken.shots[index];
    this.backToSelect({
      compare: {
        index,
        old: old ? this.deps.thumb(old, COMPARE_THUMB_W) : (this.current.thumbs[index] ?? ''),
        fresh: this.deps.thumb(shot, COMPARE_THUMB_W),
      },
    });
    const choose = this.nextPhase();
    this.set({ timerMs: RETAKE_CHOOSE_MS, timerId: this.current.timerId + 1 });
    this.after(RETAKE_CHOOSE_MS, choose, () => this.keepRetake('new'));
  }

  /** The guest picked which photo to keep after a retake (or the time ran out: the new one). */
  keepRetake(use: 'old' | 'new'): void {
    const v = this.current;
    const pending = this.pendingRetake;
    const taken = this.taken;
    if (v.phase !== 'select' || !v.compare || !pending || !taken) return;
    this.pendingRetake = null;
    const thumbs = [...v.thumbs];
    if (use === 'new') {
      taken.shots[pending.index] = pending.shot;
      thumbs[pending.index] = this.deps.thumb(pending.shot);
    }
    this.deps.log(use === 'new' ? `Foto ${pending.index + 1} diganti` : `Foto ${pending.index + 1}: tetap yang lama`);
    this.set({ compare: null, thumbs, freshShot: use === 'new' ? pending.index : null });
    this.armSelectTimeout();
  }

  /** Operator: one more retake for this session (e.g. someone walked into the shot). */
  grantRetake(): void {
    const v = this.current;
    if (v.phase !== 'select' && v.phase !== 'capturing') return;
    this.set({ retakesLeft: v.retakesLeft + 1 });
    this.deps.log(`+1 ulang dari operator (sisa ${v.retakesLeft + 1})`, 'ok');
  }

  private backToSelect(patch: Partial<GuestView>): void {
    this.set({ phase: 'select', retakeOf: null, prompt: null, count: null, shot: SHOTS, ...patch });
  }

  /* ---------- Book keychain offer ---------- */

  /** "Next" on the book info screen: on to the result screen. */
  nextFromOffer(): void {
    if (this.current.phase !== 'offer') return;
    this.showResult();
  }

  private showOffer(): void {
    const signal = this.nextPhase();
    this.set({
      phase: 'offer',
      busy: false,
      offerId: this.current.offerId + 1,
      timerMs: OFFER_MS,
      timerId: this.current.timerId + 1,
    });
    this.after(OFFER_MS, signal, () => {
      this.deps.log('Waktu penawaran buku habis');
      this.showResult();
    });
  }

  private showResult(): void {
    const o = this.offering;
    if (!o || o.run !== this.run) return;
    this.offering = null;
    const signal = this.nextPhase();
    this.set({
      phase: 'result',
      busy: false,
      timerMs: RESULT_MS,
      timerId: this.current.timerId + 1,
      thumbs: [], // big payload; not needed any more
      link: o.result.link,
      stripThumb: o.result.stripThumb,
      note: o.result.link ? null : 'QR belum tersedia. Tunjukkan kode ini ke operator ya.',
    });
    this.after(RESULT_MS, signal, () => {
      this.deps.log('Layar hasil selesai — kembali ke layar awal');
      this.reset();
    });
  }

  private armSelectTimeout(): void {
    const signal = this.nextPhase();
    this.set({ timerMs: SELECT_TIMEOUT_MS, timerId: this.current.timerId + 1 });
    this.after(SELECT_TIMEOUT_MS, signal, () => {
      if (this.current.upgradePending) {
        this.deps.log('Waktu habis, permintaan versi besar dibatalkan — kembali memilih foto');
        this.declineUpgrade();
        return;
      }
      // Fill the strip with the earliest photos the guest didn't pick, then carry on.
      const picked = [...this.current.selected];
      const count = this.current.pickCount;
      for (const i of ALL_SHOTS) if (picked.length < count && !picked.includes(i)) picked.push(i);
      this.deps.log('Waktu pilih foto habis — dipilih otomatis');
      void this.finish('standard', picked.sort((a, b) => a - b));
    });
  }

  /* ---------- Flow ---------- */

  private async capture(deck: DeckId): Promise<void> {
    const signal = this.nextPhase();
    const run = ++this.run;
    const code = this.deps.newCode();
    const shots: Shot[] = [];
    const set = this.current.set ?? 'A';
    this.deps.log(`Sesi ${code} · ${setById(set).label} · gaya ${DECKS[deck].label}`);
    this.set({
      phase: 'capturing',
      set,
      deck,
      code,
      shot: 0,
      prompt: null,
      count: null,
      retakesLeft: MAX_RETAKES,
      retakeOf: null,
      compare: null,
      freshShot: null,
    });
    const plan = this.promptBag.draw(deck);

    try {
      for (let i = 0; i < SHOTS; i++) {
        this.set({ shot: i, prompt: plan[i], count: null });
        await this.sleep(PROMPT_MS, signal);
        for (let n = COUNTDOWN_FROM; n > 0; n--) {
          this.set({ count: n });
          await this.sleep(1000, signal);
        }
        shots.push(this.deps.grab());
        this.set({ count: null, flashId: this.current.flashId + 1 });
        this.deps.log(`Foto ${i + 1}/${SHOTS}`);
        await this.sleep(AFTER_SHOT_MS, signal);
      }
    } catch (err) {
      if (err instanceof Cancelled) {
        this.deps.log('Sesi dibatalkan');
        return;
      }
      // The camera failed mid-session: don't leave the guest stuck on the countdown.
      this.deps.log(`Gagal mengambil foto: ${err instanceof Error ? err.message : String(err)}`, 'err');
      if (run === this.run) this.reset();
      return;
    }

    if (run !== this.run) return;
    this.taken = { code, shots, plan, run };
    this.set({
      phase: 'select',
      shot: SHOTS,
      prompt: null,
      count: null,
      thumbs: shots.map((s) => this.deps.thumb(s)),
      selected: [],
      pkg: 'standard',
      upgradePending: false,
    });
    this.armSelectTimeout();
  }

  /** Chosen photos are final: roll the frame, reveal it, build and upload. */
  private async finish(pkg: PrintPackage, chosen: number[]): Promise<void> {
    const taken = this.taken;
    if (!taken || this.current.phase !== 'select') return;
    this.taken = null;
    this.pendingRetake = null;
    const { code, shots, run } = taken;
    const signal = this.nextPhase();

    // Roll first: the frame is part of the print, so it has to be known before composing.
    // Only frames from the set the guest picked are in the pool. BINUS has no roll:
    // its frame is the one for the photo count the guest chose.
    const setId = this.current.set ?? 'A';
    let pick: FrameStyle;
    if (setById(setId).fixed) {
      pick = fixedFrame(setId, chosen.length);
      this.deps.log(`Frame: ${setById(setId).label} · ${chosen.length} foto (cetak 4R utuh, jangan dipotong)`, 'ok');
    } else {
      pick = roll(framesInSet(setId), this.deps.random());
      this.deps.log(`Gacha: ${pick.name} (${setById(pick.set).label}) · ${pkg === 'big' ? 'versi besar' : 'strip'}`, 'ok');
    }
    const frame = pick.id as FrameId;
    this.set({
      phase: 'reveal',
      frame,
      pkg,
      selected: chosen,
      upgradePending: false,
      compare: null,
      freshShot: null,
      busy: true, // thumbs stay: the book offer shows them
    });

    const minReveal = this.sleep(REVEAL_MS, signal).catch(() => {});
    const delivered = this.deps.deliver({ code, shots, chosen, pkg, frame }).catch((err: unknown) => {
      this.deps.log(`Gagal menyiapkan hasil: ${err instanceof Error ? err.message : String(err)}`, 'err');
      return { link: null, stripThumb: null } satisfies DeliverResult;
    });
    const [result] = await Promise.all([delivered, minReveal]);

    if (run !== this.run) return; // operator reset during the reveal
    // The QR and strip are ready now, but the book info screen comes first.
    this.offering = { run, result };
    this.showOffer();
  }
}
