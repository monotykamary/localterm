import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { useToast } from "@/components/ui/toast";
import { MAX_IMAGE_UPLOAD_BYTES } from "@monotykamary/localterm-server/protocol";
import { PASTED_IMAGE_FEEDBACK_MS, PASTED_IMAGE_TOAST_ID } from "@/lib/constants";
import { extractImageFromDataTransfer } from "@/utils/extract-image-from-data-transfer";
import { shellQuoteArg } from "@/utils/shell-quote-arg";
import { uploadPastedImage } from "@/utils/upload-pasted-image";

interface UseTerminalImagePasteOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  liveSessionIdRef: RefObject<string | null>;
  pasteToTerminalRef: RefObject<((text: string) => void) | null>;
  setIsActionsMenuOpen: Dispatch<SetStateAction<boolean>>;
}

interface PastedImageNotice {
  kind: "uploading" | "done" | "error";
  message: string;
}

export const useTerminalImagePaste = ({
  containerRef,
  liveSessionIdRef,
  pasteToTerminalRef,
  setIsActionsMenuOpen,
}: UseTerminalImagePasteOptions) => {
  const toastManager = useToast();
  const pasteImageFromBlobRef = useRef<((blob: Blob, filename: string) => Promise<void>) | null>(
    null,
  );

  const showPastedImageNotice = useCallback(
    (notice: PastedImageNotice) => {
      const toastVariant =
        notice.kind === "done" ? "success" : notice.kind === "error" ? "destructive" : "loading";
      toastManager.add({
        id: PASTED_IMAGE_TOAST_ID,
        title: notice.message,
        type: toastVariant,
        timeout: notice.kind === "uploading" ? 0 : PASTED_IMAGE_FEEDBACK_MS,
      });
    },
    [toastManager],
  );

  const pasteImageFromBlob = useCallback(
    async (blob: Blob, filename: string) => {
      const sessionId = liveSessionIdRef.current;
      if (!blob.type.startsWith("image/")) {
        showPastedImageNotice({ kind: "error", message: "Not an image" });
        return;
      }
      if (blob.size > MAX_IMAGE_UPLOAD_BYTES) {
        showPastedImageNotice({ kind: "error", message: "Image too large" });
        return;
      }
      if (!sessionId) {
        showPastedImageNotice({ kind: "error", message: "No session yet" });
        return;
      }
      showPastedImageNotice({ kind: "uploading", message: "Pasting image…" });
      try {
        const absolutePath = await uploadPastedImage(sessionId, blob, filename);
        pasteToTerminalRef.current?.(shellQuoteArg(absolutePath));
        const basename = absolutePath.split(/[/\\]/).pop() ?? absolutePath;
        showPastedImageNotice({ kind: "done", message: `Pasted ${basename}` });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Upload failed";
        showPastedImageNotice({ kind: "error", message });
      }
    },
    [liveSessionIdRef, pasteToTerminalRef, showPastedImageNotice],
  );

  useEffect(() => {
    pasteImageFromBlobRef.current = pasteImageFromBlob;
  }, [pasteImageFromBlob]);

  // The mobile entry point: open the system photo/file picker. A hidden
  // appended <input type=file> is the cross-platform path (iOS Safari blocks
  // clipboard image reads and mobile paste into xterm's off-screen textarea is
  // unreliable), so the button/keyboard key both route here. Desktop clipboard
  // paste + drag-drop are handled by the listeners below.
  const pickAndPasteImage = useCallback(() => {
    setIsActionsMenuOpen(false);
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.style.display = "none";
    document.body.appendChild(input);
    input.onchange = () => {
      const file = input.files?.[0];
      document.body.removeChild(input);
      if (file) void pasteImageFromBlobRef.current?.(file, file.name);
    };
    input.click();
  }, [setIsActionsMenuOpen]);

  // Clipboard paste (Ctrl/Cmd+V) and drag-drop onto the terminal surface. Both
  // fire on the container, which is an ancestor of xterm's helper textarea, so
  // a paste bubbles here; the capture-phase listener intercepts an image paste
  // before xterm reads the clipboard's empty text representation. Text pastes
  // fall through (no image item) so xterm's normal text paste is untouched.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handlePaste = (event: ClipboardEvent) => {
      const image = extractImageFromDataTransfer(event.clipboardData);
      if (!image) return;
      event.preventDefault();
      event.stopPropagation();
      void pasteImageFromBlobRef.current?.(image.blob, image.name);
    };
    // Suppress the browser default (navigate to the dropped file) for ANY file
    // drop so an accidental drop never leaves the terminal; only images upload.
    const handleDrop = (event: DragEvent) => {
      const image = extractImageFromDataTransfer(event.dataTransfer);
      const hasFile = event.dataTransfer?.types?.includes("Files") ?? false;
      if (!image && !hasFile) return;
      event.preventDefault();
      event.stopPropagation();
      if (image) void pasteImageFromBlobRef.current?.(image.blob, image.name);
    };
    const handleDragOver = (event: DragEvent) => {
      if (event.dataTransfer?.types?.includes("Files")) event.preventDefault();
    };
    container.addEventListener("paste", handlePaste, true);
    container.addEventListener("drop", handleDrop, true);
    container.addEventListener("dragover", handleDragOver);
    return () => {
      container.removeEventListener("paste", handlePaste, true);
      container.removeEventListener("drop", handleDrop, true);
      container.removeEventListener("dragover", handleDragOver);
    };
  }, [containerRef]);

  return pickAndPasteImage;
};
