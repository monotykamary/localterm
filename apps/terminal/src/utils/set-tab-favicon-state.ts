import { buildFaviconSvg } from "./build-favicon-svg";
import { type FaviconState, markFaviconPainted, shouldRepaintFavicon } from "./favicon-state-store";

export const setTabFaviconState = (state: FaviconState, hasBadge = false): void => {
  if (typeof document === "undefined") return;
  if (!shouldRepaintFavicon(state, hasBadge)) return;
  markFaviconPainted(state, hasBadge);
  const href = `data:image/svg+xml,${encodeURIComponent(buildFaviconSvg(state, hasBadge))}`;

  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.type = "image/svg+xml";
  link.href = href;
};
