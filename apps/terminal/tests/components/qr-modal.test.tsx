import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { QrModal } from "../../src/components/qr-modal";
import { buildSessionShareUrl } from "../../src/utils/build-session-share-url";

vi.mock("qrcode.react", () => ({
  QRCodeCanvas: ({ value }: { value: string }) => (
    <div role="img" aria-label="session share QR code" data-value={value} />
  ),
}));

// The camera loop is unit-tested in tests/hooks/use-qr-scanner.test.tsx; here
// we stub the hook so the modal test can drive detections directly and assert
// the switch/close wiring without a real camera.
let mockScannerHandle: {
  enabled: boolean;
  onDetect: (data: string) => void;
} | null = null;

vi.mock("../../src/hooks/use-qr-scanner", () => ({
  useQrScanner: ({ enabled, onDetect }: { enabled: boolean; onDetect: (data: string) => void }) => {
    mockScannerHandle = { enabled, onDetect };
    return { videoRef: { current: null }, status: "scanning" };
  },
}));

interface RenderOptions {
  open?: boolean;
  liveSessionId?: string | null;
  switchSession?: (sid: string) => void;
  onClose?: () => void;
}

const renderModal = (options: RenderOptions = {}) => {
  const liveSessionIdRef = { current: options.liveSessionId ?? null };
  const switchSessionRef = { current: options.switchSession ?? null };
  const peerAttachedRef: { current: (() => void) | null } = { current: null };
  const onClose = options.onClose ?? vi.fn();
  render(
    <QrModal
      open={options.open ?? true}
      liveSessionIdRef={liveSessionIdRef}
      switchSessionRef={switchSessionRef}
      peerAttachedRef={peerAttachedRef}
      onClose={onClose}
    />,
  );
  return { liveSessionIdRef, switchSessionRef, peerAttachedRef, onClose };
};

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  mockScannerHandle = null;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("QrModal", () => {
  it("renders the share QR for the current session", () => {
    renderModal({ liveSessionId: "abc" });
    const qr = screen.getByRole("img", { name: "session share QR code" });
    expect(qr.getAttribute("data-value")).toBe(buildSessionShareUrl("abc"));
  });

  it("shows the empty state when there is no live session yet", () => {
    renderModal({ liveSessionId: null });
    expect(screen.getByText(/No live session to share yet/i)).toBeDefined();
    expect(screen.queryByRole("img", { name: "session share QR code" })).toBeNull();
  });

  it("defaults to share mode and starts the scanner only after switching to ingest", () => {
    renderModal({ liveSessionId: "abc" });
    expect(mockScannerHandle?.enabled).toBe(false);

    fireEvent.click(screen.getByRole("tab", { name: /ingest/i }));
    expect(mockScannerHandle?.enabled).toBe(true);
    expect(screen.getByLabelText("camera preview")).toBeDefined();
    expect(screen.getByText(/Point at another device's session QR/i)).toBeDefined();
  });

  it("switches to the scanned session and closes on a valid QR", () => {
    const switchSession = vi.fn();
    const onClose = vi.fn();
    renderModal({ liveSessionId: null, switchSession, onClose });
    fireEvent.click(screen.getByRole("tab", { name: /ingest/i }));

    mockScannerHandle?.onDetect("https://localterm.localhost/?sid=abc123");

    expect(switchSession).toHaveBeenCalledWith("abc123");
    expect(onClose).toHaveBeenCalled();
  });

  it("ignores a non-session QR and keeps the modal open", () => {
    const switchSession = vi.fn();
    const onClose = vi.fn();
    renderModal({ liveSessionId: null, switchSession, onClose });
    fireEvent.click(screen.getByRole("tab", { name: /ingest/i }));

    mockScannerHandle?.onDetect("https://example.com/?foo=bar");

    expect(switchSession).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    renderModal({ liveSessionId: "abc", onClose });

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(onClose).toHaveBeenCalled();
  });

  it("closes on backdrop click", () => {
    const onClose = vi.fn();
    renderModal({ liveSessionId: "abc", onClose });
    const container = screen.getByRole("dialog", {
      name: /share or ingest a session via QR/i,
    }).parentElement as HTMLElement;

    fireEvent.click(container.firstElementChild as HTMLElement);

    expect(onClose).toHaveBeenCalled();
  });

  it("closes the share modal when a peer attaches (mobile ingested the QR)", () => {
    const onClose = vi.fn();
    const { peerAttachedRef } = renderModal({ liveSessionId: "abc", onClose });

    peerAttachedRef.current?.();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the ingest modal open when a peer attaches", () => {
    const onClose = vi.fn();
    const { peerAttachedRef } = renderModal({ liveSessionId: "abc", onClose });
    fireEvent.click(screen.getByRole("tab", { name: /ingest/i }));

    peerAttachedRef.current?.();

    expect(onClose).not.toHaveBeenCalled();
  });

  it("does nothing when a peer attaches while the modal is closed", () => {
    const onClose = vi.fn();
    const { peerAttachedRef } = renderModal({ open: false, liveSessionId: "abc", onClose });

    peerAttachedRef.current?.();

    expect(onClose).not.toHaveBeenCalled();
  });
});
