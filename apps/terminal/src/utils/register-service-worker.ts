export const registerServiceWorker = (): void => {
  if (import.meta.env.DEV) return;
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error: unknown) => {
    console.warn("localterm: service worker registration failed", error);
  });
};
