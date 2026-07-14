import { describe, expect, it } from "vite-plus/test";
import { shouldSuppressSessionNotification } from "../../src/utils/should-suppress-session-notification";

describe("shouldSuppressSessionNotification", () => {
  it("suppresses a non-viewer tab when the session is viewed elsewhere (cross-tab)", () => {
    expect(
      shouldSuppressSessionNotification({
        isViewer: false,
        hasViewers: true,
        documentVisible: false,
        documentFocused: false,
      }),
    ).toBe(true);
  });

  it("does not suppress a non-viewer tab for an orphaned session (no viewer anywhere)", () => {
    // Every tab pings so a click can reopen the session; the tab's own
    // foreground state is irrelevant since it isn't viewing the session.
    for (const documentVisible of [true, false]) {
      for (const documentFocused of [true, false]) {
        expect(
          shouldSuppressSessionNotification({
            isViewer: false,
            hasViewers: false,
            documentVisible,
            documentFocused,
          }),
        ).toBe(false);
      }
    }
  });

  it("suppresses the viewer tab when it is the visible, focused foreground tab", () => {
    expect(
      shouldSuppressSessionNotification({
        isViewer: true,
        hasViewers: true,
        documentVisible: true,
        documentFocused: true,
      }),
    ).toBe(true);
  });

  it("does not suppress the viewer tab when the tab is hidden (background tab)", () => {
    expect(
      shouldSuppressSessionNotification({
        isViewer: true,
        hasViewers: true,
        documentVisible: false,
        documentFocused: false,
      }),
    ).toBe(false);
  });

  it("does not suppress the viewer tab when the window lost focus to another app", () => {
    // document.hidden stays false here (the tab is still its window's visible
    // tab), but hasFocus() is false — the user stepped away, so the ping fires.
    expect(
      shouldSuppressSessionNotification({
        isViewer: true,
        hasViewers: true,
        documentVisible: true,
        documentFocused: false,
      }),
    ).toBe(false);
  });

  it("does not suppress a focused-but-hidden viewer tab (defensive against quirks)", () => {
    // hasFocus implies visible per spec; a hidden-but-focused report still
    // fires rather than muting the only signal the user would get.
    expect(
      shouldSuppressSessionNotification({
        isViewer: true,
        hasViewers: true,
        documentVisible: false,
        documentFocused: true,
      }),
    ).toBe(false);
  });
});
