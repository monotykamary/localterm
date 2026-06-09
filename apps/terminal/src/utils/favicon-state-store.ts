export type FaviconState = "ready" | "running" | "dead";

let currentState: FaviconState = "ready";
let lastPaintedState: FaviconState | null = null;

export const shouldRepaintFavicon = (nextState: FaviconState): boolean =>
  lastPaintedState === null || nextState !== currentState;

export const markFaviconPainted = (nextState: FaviconState): void => {
  currentState = nextState;
  lastPaintedState = nextState;
};

export const resetFaviconStateStore = (): void => {
  currentState = "ready";
  lastPaintedState = null;
};
