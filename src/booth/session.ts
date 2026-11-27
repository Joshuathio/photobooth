import {
  AFTER_SHOT_MS,
  COUNTDOWN_FROM,
  DECK_TIMEOUT_MS,
  DECKS,
  MAX_RETAKES,
  PROMPT_MS,
  RESULT_MS,
  REVEAL_MS,
  SELECT_TIMEOUT_MS,
  SHOTS,
  type DeckId,
} from './config';
import { FRAMES, frameById, isFrameId, type FrameId } from './gacha';
import { PromptBag } from './prompts';
import { Cancelled, sleep as realSleep } from './timing';
import type { GuestIntent } from '../shared/link-protocol';
import { IDLE_VIEW, type GuestView } from '../shared/view';

export interface DeliverInput<Shot> {
  code: string;
  /** Every shot taken, in order. */
  shots: Shot[];
  /** Indexes of the shots on the strip. */
  chosen: number[];
  frame: FrameId;
}

export interface DeliverResult {
  link: string | null;
  stripThumb: string | null;
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
 * idle → frame → deck → capturing → select → reveal → result → idle.
 * From select, a retake goes capturing (one shot) → select again.
 * Both the Mac console and the tablet just render `view`.
 */
export class BoothSession<Shot = unknown> {
  private current: GuestView = IDLE_VIEW;
  private phaseCtl = new AbortController();
  private run = 0;
  /** The session waiting on the selection screen. */
  private taken: { code: string; shots: Shot[]; plan: string[]; run: number } | null = null;
  /** Deals each session's poses so back-to-back groups get different ones. */
  private readonly promptBag: PromptBag;
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

  /** Attract screen → frame picker. */
  begin(): void {
    if (this.current.phase !== 'idle') return;
    this.current = { ...IDLE_VIEW, flashId: this.current.flashId };
    this.showPicker('frame');
  }

  /** Frame or pose picker, with a timeout back to the attract screen if nobody taps. */
  private showPicker(phase: 'frame' | 'deck'): void {
    const signal = this.nextPhase();
    this.set({ phase, timerMs: DECK_TIMEOUT_MS, timerId: this.current.timerId + 1 });
    this.after(DECK_TIMEOUT_MS, signal, () => {
      this.deps.log(`Tidak ada yang pilih ${phase === 'frame' ? 'frame' : 'gaya'} — kembali ke layar awal`);
      this.reset();
    });
  }

  /** Highlight a frame on the frame screen. The guest still has to confirm it. */
  pickFrame(frame: FrameId): void {
    if (this.current.phase !== 'frame' || !isFrameId(frame)) return;
    this.set({ frame });
  }

  /** Highlighted frame → pose picker. */
  confirmFrame(): void {
    if (this.current.phase !== 'frame' || !this.current.frame) return;
    this.showPicker('deck');
  }

  /** Pose picker → back to the frame screen, keeping the frame highlighted. */
  backToFrame(): void {
    if (this.current.phase !== 'deck') return;
    this.showPicker('frame');
  }

  /** Deck picked → take the photos, then show the selection screen. */
  chooseDeck(deck: DeckId): Promise<void> {
    if (this.current.phase !== 'deck') return Promise.resolve();
    return this.capture(deck);
  }

  /**
   * Mac shortcut (Space): start, then confirm the frame (the first one if none is
   * highlighted), then pick the default deck.
   */
  quickStart(defaultDeck: DeckId): void {
    switch (this.current.phase) {
      case 'idle':
        this.begin();
        break;
      case 'frame':
        if (!this.current.frame) this.pickFrame(FRAMES[0].id);
        this.confirmFrame();
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
      case 'frame':
        this.pickFrame(intent.frame);
        break;
      case 'confirmFrame':
        this.confirmFrame();
        break;
      case 'deck':
        void this.chooseDeck(DECKS[intent.deck] ? intent.deck : defaultDeck);
        break;
      case 'back':
        this.backToFrame();
        break;
      case 'cancel':
        if (this.current.phase === 'frame' || this.current.phase === 'deck') this.reset();
        break;
      case 'toggle':
        this.toggle(intent.index);
        break;
      case 'retake':
        void this.retake(intent.index);
        break;
      case 'confirm':
        void this.confirm();
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
    this.current = { ...IDLE_VIEW, flashId: this.current.flashId };
    this.onChange(this.current);
  }

  /* ---------- Selection ---------- */

  toggle(index: number): void {
    const v = this.current;
    if (v.phase !== 'select' || !Number.isInteger(index)) return;
    if (index < 0 || index >= SHOTS) return;
    if (v.selected.includes(index)) {
      this.set({ selected: v.selected.filter((i) => i !== index) });
    } else if (v.selected.length < v.pickCount) {
      this.set({ selected: [...v.selected, index].sort((a, b) => a - b) });
    }
  }

  /** Guest is done picking. Only works with exactly pickCount photos chosen (4). */
  confirm(): Promise<void> {
    const v = this.current;
    if (v.phase !== 'select' || v.selected.length !== v.pickCount) {
      return Promise.resolve();
    }
    return this.finish(v.selected);
  }

  /* ---------- Retake ---------- */

  /**
   * Retake one photo from the select screen with the same prompt and countdown.
   * The new photo replaces the old one straight away.
   */
  async retake(index: number): Promise<void> {
    const v = this.current;
    const taken = this.taken;
    if (v.phase !== 'select' || !taken) return;
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

    taken.shots[index] = shot;
    const thumbs = [...this.current.thumbs];
    thumbs[index] = this.deps.thumb(shot);
    this.deps.log(`Foto ${index + 1} diganti`);
    this.backToSelect({ thumbs, freshShot: index });
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

  /* ---------- Result ---------- */

  private showResult(result: DeliverResult): void {
    const signal = this.nextPhase();
    this.set({
      phase: 'result',
      busy: false,
      timerMs: RESULT_MS,
      timerId: this.current.timerId + 1,
      thumbs: [], // big payload; not needed any more
      link: result.link,
      stripThumb: result.stripThumb,
      note: result.link ? null : 'QR belum tersedia. Tunjukkan kode ini ke operator ya.',
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
      // Fill the strip with the earliest photos the guest didn't pick, then carry on.
      const picked = [...this.current.selected];
      const count = this.current.pickCount;
      for (const i of ALL_SHOTS) if (picked.length < count && !picked.includes(i)) picked.push(i);
      this.deps.log('Waktu pilih foto habis — dipilih otomatis');
      void this.finish(picked.sort((a, b) => a - b));
    });
  }

  /* ---------- Flow ---------- */

  private async capture(deck: DeckId): Promise<void> {
    const signal = this.nextPhase();
    const run = ++this.run;
    const code = this.deps.newCode();
    const shots: Shot[] = [];
    const frame = this.current.frame ?? FRAMES[0].id;
    this.deps.log(`Sesi ${code} · ${frameById(frame).name} · gaya ${DECKS[deck].label}`);
    this.set({
      phase: 'capturing',
      frame,
      deck,
      code,
      shot: 0,
      prompt: null,
      count: null,
      retakesLeft: MAX_RETAKES,
      retakeOf: null,
      freshShot: null,
      timerMs: null,
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
    });
    this.armSelectTimeout();
  }

  /** Chosen photos are final: build and upload with the frame the guest picked. */
  private async finish(chosen: number[]): Promise<void> {
    const taken = this.taken;
    if (!taken || this.current.phase !== 'select') return;
    this.taken = null;
    const { code, shots, run } = taken;
    const signal = this.nextPhase();

    const frame = this.current.frame ?? FRAMES[0].id;
    this.deps.log(`Frame: ${frameById(frame).name}`, 'ok');
    this.set({
      phase: 'reveal',
      frame,
      selected: chosen,
      freshShot: null,
      busy: true,
    });

    const minReveal = this.sleep(REVEAL_MS, signal).catch(() => {});
    const delivered = this.deps.deliver({ code, shots, chosen, frame }).catch((err: unknown) => {
      this.deps.log(`Gagal menyiapkan hasil: ${err instanceof Error ? err.message : String(err)}`, 'err');
      return { link: null, stripThumb: null } satisfies DeliverResult;
    });
    const [result] = await Promise.all([delivered, minReveal]);

    if (run !== this.run) return; // operator reset during the reveal
    this.showResult(result);
  }
}
