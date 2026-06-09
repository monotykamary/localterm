import { resetFaviconStateStore } from "./favicon-state-store";
import { setTabFaviconState } from "./set-tab-favicon-state";

export const applyTabFavicon = (): void => {
  resetFaviconStateStore();
  setTabFaviconState("ready");
};
