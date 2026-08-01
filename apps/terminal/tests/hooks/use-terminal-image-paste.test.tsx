import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { useTerminalImagePaste } from "../../src/hooks/use-terminal-image-paste";

const mocks = vi.hoisted(() => ({
  addToast: vi.fn(),
  upload: vi.fn(),
}));

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ add: mocks.addToast }),
}));

vi.mock("@/utils/upload-pasted-image", () => ({
  uploadPastedImage: mocks.upload,
}));

interface HarnessProps {
  paste: (text: string) => void;
}

interface DataTransferFixtureOptions {
  files?: File[];
  types?: string[];
}

interface UploadOptions {
  signal: AbortSignal;
}

interface SignalCapture {
  current: AbortSignal | null;
}

const Harness = ({ paste }: HarnessProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sessionIdRef = useRef<string | null>("session-id");
  const pasteRef = useRef<((text: string) => void) | null>(paste);
  const [, setIsActionsMenuOpen] = useState(false);
  useTerminalImagePaste({
    containerRef,
    liveSessionIdRef: sessionIdRef,
    pasteToTerminalRef: pasteRef,
    setIsActionsMenuOpen,
  });
  return <div ref={containerRef} data-testid="terminal" />;
};

const createDataTransfer = ({
  files = [],
  types = files.length > 0 ? ["Files"] : [],
}: DataTransferFixtureOptions): DataTransfer => {
  const items = files.map((file) => ({
    kind: "file",
    type: file.type,
    getAsFile: () => file,
  }));
  return {
    dropEffect: "none",
    files,
    items,
    types,
  } as unknown as DataTransfer;
};

const drop = (dataTransfer: DataTransfer): Event => {
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  fireEvent(screen.getByTestId("terminal"), event);
  return event;
};

afterEach(() => {
  mocks.addToast.mockReset();
  mocks.upload.mockReset();
});

describe("useTerminalImagePaste", () => {
  it("uploads a dropped image with missing MIME metadata", async () => {
    const paste = vi.fn();
    mocks.upload.mockResolvedValue("/tmp/pasted image.png");
    render(<Harness paste={paste} />);

    const event = drop(createDataTransfer({ files: [new File(["png"], "Screenshot.PNG")] }));

    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(1));
    expect(mocks.upload.mock.calls[0]?.[1]).toBeInstanceOf(Blob);
    expect(mocks.upload.mock.calls[0]?.[1].type).toBe("image/png");
    await waitFor(() => expect(paste).toHaveBeenCalledWith("'/tmp/pasted image.png'"));
    expect(mocks.addToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Pasted pasted image.png", type: "success" }),
    );
  });

  it("blocks URL-backed drops instead of navigating or failing silently", () => {
    render(<Harness paste={vi.fn()} />);

    const event = drop(createDataTransfer({ types: ["text/uri-list", "text/html"] }));

    expect(event.defaultPrevented).toBe(true);
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.addToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Drop an image file instead", type: "destructive" }),
    );
  });

  it("reports unsupported file drops", () => {
    render(<Harness paste={vi.fn()} />);

    drop(
      createDataTransfer({
        files: [new File(["<svg/>"], "icon.svg", { type: "image/svg+xml" })],
      }),
    );

    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.addToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Unsupported image type", type: "destructive" }),
    );
  });

  it("cancels a superseded upload and pastes only the latest path", async () => {
    const paste = vi.fn();
    const firstSignal: SignalCapture = { current: null };
    mocks.upload
      .mockImplementationOnce(
        (_sessionId: string, _blob: Blob, _filename: string, options: UploadOptions) =>
          new Promise<string>((_resolve, reject) => {
            firstSignal.current = options.signal;
            options.signal.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      )
      .mockResolvedValueOnce("/tmp/latest.png");
    render(<Harness paste={paste} />);

    drop(createDataTransfer({ files: [new File(["one"], "one.png")] }));
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(1));
    drop(createDataTransfer({ files: [new File(["two"], "two.png")] }));

    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(2));
    expect(firstSignal.current?.aborted).toBe(true);
    await waitFor(() => expect(paste).toHaveBeenCalledWith("'/tmp/latest.png'"));
    expect(paste).toHaveBeenCalledTimes(1);
  });

  it("aborts an in-flight upload when the terminal unmounts", async () => {
    const uploadSignal: SignalCapture = { current: null };
    mocks.upload.mockImplementation(
      (_sessionId: string, _blob: Blob, _filename: string, options: UploadOptions) =>
        new Promise<string>((_resolve, reject) => {
          uploadSignal.current = options.signal;
          options.signal.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const view = render(<Harness paste={vi.fn()} />);
    drop(createDataTransfer({ files: [new File(["png"], "image.png")] }));
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(1));

    view.unmount();

    expect(uploadSignal.current?.aborted).toBe(true);
  });
});
