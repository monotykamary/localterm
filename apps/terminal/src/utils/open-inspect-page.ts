const CDP_OPEN_INSPECT_ENDPOINT = "/api/cdp/open-inspect";

// Open chrome://inspect in the user's debug-enabled browser. Routed through
// the daemon because chrome:// URLs can't be navigated to from a web page:
// the daemon opens a foreground CDP tab in the connected Chromium (or falls
// back to the OS opener when no browser is reachable).
export const openInspectPage = async (): Promise<boolean> => {
  try {
    const response = await fetch(new URL(CDP_OPEN_INSPECT_ENDPOINT, window.location.href), {
      method: "POST",
    });
    return response.ok;
  } catch {
    return false;
  }
};
