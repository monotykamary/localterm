if (import.meta.env.DEV) {
  import("react-grab");
}

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TOOLTIP_DELAY_MS } from "@/lib/constants";
import { applyTabFavicon } from "./utils/apply-tab-favicon";
import { loadGoogleFontsStylesheet } from "./utils/load-google-fonts-stylesheet";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";
import "@fontsource/geist-mono/600.css";
import "./nerd-font.css";
import "./index.css";

applyTabFavicon();
loadGoogleFontsStylesheet();

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element not found");

createRoot(rootElement).render(
  <StrictMode>
    <TooltipProvider delay={TOOLTIP_DELAY_MS}>
      <App />
    </TooltipProvider>
  </StrictMode>,
);
