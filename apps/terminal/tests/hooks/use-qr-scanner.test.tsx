import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useQrScanner } from "../../src/hooks/use-qr-scanner";

interface HarnessProps {
  enabled: boolean;
  onDetect: (data: string) => void;
}

const Harness = ({ enabled, onDetect }: HarnessProps) => {
  const { videoRef, status } = useQrScanner({ enabled, onDetect });
  return <video ref={videoRef} data-testid="vid" data-status={status} />;
};

// The camera-decode loop needs a live MediaStream + canvas + rAF and is
// exercised manually; these tests cover the state machine that doesn't depend
// on the camera: the disabled fast-path and the getUserMedia error mapping.
let getUserMediaMock: ReturnType<typeof vi.fn>;

const statusOf = () => screen.getByTestId("vid").getAttribute("data-status");

beforeEach(() => {
  getUserMediaMock = vi.fn(async () => ({
    getTracks: () => [{ stop: vi.fn() }],
  }));
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: getUserMediaMock },
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: undefined,
  });
});

describe("useQrScanner state machine", () => {
  it("stays idle and never opens the camera when disabled", () => {
    render(<Harness enabled={false} onDetect={vi.fn()} />);
    expect(statusOf()).toBe("idle");
    expect(getUserMediaMock).not.toHaveBeenCalled();
  });

  it("reports unavailable when the device has no mediaDevices", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: undefined,
    });
    render(<Harness enabled onDetect={vi.fn()} />);
    await vi.waitFor(() => expect(statusOf()).toBe("unavailable"));
    expect(getUserMediaMock).not.toHaveBeenCalled();
  });

  it("reports denied when the user blocks camera access", async () => {
    getUserMediaMock.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));
    render(<Harness enabled onDetect={vi.fn()} />);
    await vi.waitFor(() => expect(statusOf()).toBe("denied"));
  });

  it("reports unavailable when no camera is found", async () => {
    getUserMediaMock.mockRejectedValueOnce(new DOMException("none", "NotFoundError"));
    render(<Harness enabled onDetect={vi.fn()} />);
    await vi.waitFor(() => expect(statusOf()).toBe("unavailable"));
  });

  it("reports failed for any other camera error", async () => {
    getUserMediaMock.mockRejectedValueOnce(new Error("boom"));
    render(<Harness enabled onDetect={vi.fn()} />);
    await vi.waitFor(() => expect(statusOf()).toBe("failed"));
  });
});
