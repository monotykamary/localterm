export type FaviconState = "ready" | "running" | "alive-quiet" | "dead";

let currentState: FaviconState = "ready";
let lastPaintedState: FaviconState | null = null;
let badgeVisible = false;

export const shouldRepaintFavicon = (nextState: FaviconState, nextBadge: boolean): boolean =>
  lastPaintedState === null || nextState !== currentState || nextBadge !== badgeVisible;

export const markFaviconPainted = (nextState: FaviconState, nextBadge: boolean): void => {
  currentState = nextState;
  lastPaintedState = nextState;
  badgeVisible = nextBadge;
};

export const resetFaviconStateStore = (): void => {
  currentState = "ready";
  lastPaintedState = null;
  badgeVisible = false;
};
