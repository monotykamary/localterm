// Seed for the coffee button before the first WS `{type:"caffeinate"}` frame
// reports the server's authoritative `supported` flag. Keep-awake works on
// macOS and Linux, so a native install on either pre-shows the button instead
// of flashing it in once the daemon confirms support. Non-matching platforms
// (Windows, or a browser with a spoofed UA) seed false and reveal the button
// only if the server actually supports it — the supported-unknown case degrades
// to a brief flash rather than a wrong sticky state.
export const detectLikelyKeepAwakeSupported = (): boolean => {
  if (typeof navigator === "undefined") return false;
  const platform = navigator.platform || navigator.userAgent || "";
  return /Mac|iPhone|iPad|iPod|Linux|X11/i.test(platform);
};
