interface ShowServiceWorkerNotificationOptions {
  body: string;
  hasViewers: boolean;
  sessionId: string;
  tag: string;
  title: string;
}

export const showServiceWorkerNotification = ({
  body,
  hasViewers,
  sessionId,
  tag,
  title,
}: ShowServiceWorkerNotificationOptions): boolean => {
  const controller = navigator.serviceWorker?.controller;
  if (!controller) return false;
  controller.postMessage({
    type: "show-session-notification",
    body,
    hasViewers,
    sessionId,
    tag,
    title,
  });
  return true;
};
