// `(pointer: coarse)` describes only the primary pointer, so touch laptops
// with a trackpad report fine. `(any-pointer: coarse)` surfaces a touchscreen
// present anywhere in the input set.
export const detectTouchPresent = (): boolean => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(any-pointer: coarse)").matches;
};
