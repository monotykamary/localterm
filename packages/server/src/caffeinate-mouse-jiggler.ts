import { defaultMouseJiggle } from "./caffeinate-platform.js";
import { CAFFEINATE_MOUSE_JIGGLE_INTERVAL_MS } from "./constants.js";

export interface MouseJigglerOptions {
  // Injectable jiggle action so tests never post real input events. Defaults
  // to the platform's one-shot command (JXA on macOS, xdotool on Linux).
  jiggle?: () => void;
  intervalMs?: number;
}

// Nudges the cursor on a fixed interval while the keep-awake assertion is
// held. Purely additive to caffeinate: the power assertion already blocks OS
// idle sleep, but apps that watch raw input events (presence/away detectors)
// never see one — the jiggle fabricates that input. Follows the controller's
// active state, so it starts/stops exactly when keep-awake does.
export class MouseJiggler {
  private readonly jiggle: () => void;
  private readonly intervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private warned = false;

  constructor(options: MouseJigglerOptions = {}) {
    this.jiggle = options.jiggle ?? defaultMouseJiggle;
    this.intervalMs = options.intervalMs ?? CAFFEINATE_MOUSE_JIGGLE_INTERVAL_MS;
  }

  get active(): boolean {
    return this.timer !== null;
  }

  setActive(enabled: boolean): void {
    if (enabled) {
      if (this.timer) return;
      this.jiggleSafely();
      this.timer = setInterval(() => this.jiggleSafely(), this.intervalMs);
      // Never hold the daemon's exit for a cursor nudge.
      this.timer.unref();
    } else {
      if (this.timer === null) return;
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  dispose(): void {
    this.setActive(false);
  }

  private jiggleSafely(): void {
    try {
      this.jiggle();
      this.warned = false;
    } catch (error) {
      // A persistently broken jiggle (xdotool missing on a minimal Linux)
      // must not spam the log every interval; warn once per failure streak.
      if (this.warned) return;
      this.warned = true;
      console.warn("mouse jiggle failed; continuing without input events", error);
    }
  }
}
