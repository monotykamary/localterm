import { buildFaviconSvg } from "./build-favicon-svg";
import { type FaviconState, markFaviconPainted, shouldRepaintFavicon } from "./favicon-state-store";

export const setTabFaviconState = (state: FaviconState): void => {
  if (typeof document === "undefined") return;
  if (!shouldRepaintFavicon(state)) return;
  markFaviconPainted(state);
  const href = `data:image/svg+xml,${encodeURIComponent(buildFaviconSvg(state))}`;

  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.type = "image/svg+xml";
  link.href = href;
};
