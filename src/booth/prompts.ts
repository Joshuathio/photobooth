import { DECKS, LAST_PROMPT, SHOTS, type Deck, type DeckId } from './config';

/**
 * Picks the prompts for a session like dealing from a shuffled deck of cards:
 * each gaya's pool is shuffled and dealt from the top, and only reshuffled
 * once it runs out. So a prompt doesn't come back until every other prompt of
 * that gaya has been used — groups queuing one after another always get
 * different poses.
 *
 * Every session gets SHOTS - 1 prompts from the pool and ends on LAST_PROMPT
 * (their own pose). Free decks (Bebas) just use their cues in order.
 */
export class PromptBag {
  private readonly piles = new Map<DeckId, string[]>();

  constructor(private readonly random: () => number) {}

  draw(deck: DeckId): string[] {
    const d: Deck = DECKS[deck];
    if (d.free) return Array.from({ length: SHOTS }, (_, i) => d.prompts[i] ?? LAST_PROMPT);

    const picked: string[] = [];
    let pile = this.piles.get(deck) ?? [];
    while (picked.length < SHOTS - 1) {
      if (pile.length === 0) {
        // Reshuffle the whole pool. What this session already has goes to the bottom
        // (dealt last), so nothing repeats within the session and nothing skips a round.
        const fresh = this.shuffle(d.prompts.filter((p) => !picked.includes(p)));
        if (fresh.length === 0) break; // pool smaller than a session (shouldn't happen)
        pile = [...this.shuffle(picked), ...fresh]; // pop() deals from the end
      }
      picked.push(pile.pop()!);
    }
    this.piles.set(deck, pile);
    return [...picked, LAST_PROMPT];
  }

  /** Fisher–Yates with the session's random source. */
  private shuffle(items: readonly string[]): string[] {
    const a = [...items];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}
