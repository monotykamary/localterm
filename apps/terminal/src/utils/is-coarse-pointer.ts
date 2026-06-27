// "Touch-primary device with no fine pointer" — phones and tablets whose
// primary input is a finger. Touch laptops with a trackpad report
// `(pointer: fine)`, so they stay on the desktop hover path instead of the
// tap-to-toggle path. Drives the ambient toolbar toggle and the
// on-screen-keyboard viewport sizing.
export const isCoarsePointer = (): boolean => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(pointer: coarse)").matches;
};
