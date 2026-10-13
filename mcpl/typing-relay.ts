/**
 * Keeps an agent's typing dots up in the world while its host says the agent
 * is composing (MCPL `channels/typing`).
 *
 * The host sends `start` when a turn begins and again every 7 s while it runs
 * (agent-framework's `TYPING_INTERVAL_MS`), and `stop` when the turn ends. The
 * world draws the dots for 4 s after each signal (`setTyping` in
 * client/lib/avatar.js), so one signal per `start` would leave a gap of about
 * 3 s in every 7. The relay signals again every `reassertMs`, the cadence the
 * client expects, until `stop`. It also stops by itself once no `start` has
 * come for `overdueMs`, so a `stop` that never arrives can't leave the dots up.
 */
export class TypingRelay {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastStart = 0;

  constructor(
    private readonly signal: () => void,
    private readonly reassertMs = 2_500,
    private readonly overdueMs = 10_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** The host said `start`, or sent `channels/typing` with no `op`. */
  start(): void {
    this.lastStart = this.now();
    this.signal();
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.now() - this.lastStart > this.overdueMs) {
        this.stop();
        return;
      }
      this.signal();
    }, this.reassertMs);
  }

  /** The host said `stop`, the body left this world, or the session ended. */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Whether the relay is keeping the dots up. */
  get active(): boolean {
    return this.timer !== null;
  }
}
