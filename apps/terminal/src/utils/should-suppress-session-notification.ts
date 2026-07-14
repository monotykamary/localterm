export interface ShouldSuppressSessionNotificationOptions {
  isViewer: boolean;
  hasViewers: boolean;
  documentVisible: boolean;
  // document.hasFocus(): the user is actively in this tab/window. This — not
  // document.hidden — is what catches a window left visible behind another app
  // (Cmd-Tab away while the localterm window stays on screen): document.hidden
  // stays false there, since the tab is still its window's visible tab.
  documentFocused: boolean;
}

// Whether a tab receiving the daemon's fanned-out `notification` message
// should skip firing the OS notification. The daemon delivers the same OSC 9
// notification to every connected tab; only one should show it, and never the
// one the user is already looking at.
//
// 1. Cross-tab: a tab not viewing this session stays silent when the session
//    is viewed elsewhere, so the viewer's profile owns the click — a
//    profile-isolated service worker can't focus another profile's tab.
// 2. Foreground viewer: the tab already viewing this session in the foreground
//    can see the result on screen (e.g. pi finishing), so an OS notification
//    only duplicates what the user is watching.
export const shouldSuppressSessionNotification = ({
  isViewer,
  hasViewers,
  documentVisible,
  documentFocused,
}: ShouldSuppressSessionNotificationOptions): boolean => {
  if (!isViewer && hasViewers) return true;
  if (isViewer && documentVisible && documentFocused) return true;
  return false;
};
