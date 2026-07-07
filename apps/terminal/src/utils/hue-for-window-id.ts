// A stable hue (0–359) derived from a per-browser-profile window id, so each
// other profile gets a distinct, glanceable color in the session picker's
// peer dots. The picker's own profile overrides this with the foreground color;
// this is only for the "other profiles" dots, so two different other-profiles
// read as different colors while a single profile's windows share one.
export const hueForWindowId = (windowId: string): number => {
  let hash = 0;
  for (let index = 0; index < windowId.length; index += 1) {
    hash = (hash * 31 + windowId.charCodeAt(index)) >>> 0;
  }
  return hash % 360;
};
