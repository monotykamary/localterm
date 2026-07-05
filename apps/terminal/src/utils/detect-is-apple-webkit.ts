// Apple WebKit (Safari, and every iOS browser — Chrome/Firefox/Edge on iOS are
// forced onto WebKit) ignores the `interactive-widget` viewport hint, so the
// keyboard overlays the layout viewport instead of resizing it (Chromium
// honors it). `navigator.vendor` is the clean engine signal ("Apple Computer,
// Inc." vs Chromium's "Google Inc."), excluding Android Chrome.
export const detectIsAppleWebKit = (): boolean => {
  if (typeof navigator === "undefined") return false;
  return navigator.vendor === "Apple Computer, Inc.";
};
