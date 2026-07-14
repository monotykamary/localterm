import { type ReactElement, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, FileWarning, ImageOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { MODAL_PANEL_CLASSES } from "@/lib/animation-classes";
import { isImagePath } from "@monotykamary/localterm-server/protocol";
import { buildFileContentUrl } from "@/utils/build-file-content-url";
import { buildFileUrl } from "@/utils/build-file-url";
import { splitFilePath } from "@/utils/split-file-path";

interface FilePreviewModalProps {
  readonly cwd: string;
  readonly filePath: string;
  readonly onClose: () => void;
}

type TextState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly content: string }
  | { readonly status: "error"; readonly message: string };

const messageForStatus = (status: number): string => {
  if (status === 404) return "File not found.";
  if (status === 413) return "File is too large to preview.";
  if (status === 415) return "Can't preview a binary file.";
  return "Couldn't load the file.";
};

const PreviewError = ({ icon, message }: { icon: ReactElement; message: string }): ReactElement => (
  <div className="flex h-full flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
    {icon}
    <span className="text-xs">{message}</span>
  </div>
);

// Clicking a repo-relative path in the agent transcript opens this inline
// preview: images render straight from /api/file, everything else is fetched
// as text/plain from /api/file/content and shown read-only. Esc, backdrop
// click, or the X closes. It's a portal to body so it overlays the log.
export const FilePreviewModal = ({
  cwd,
  filePath,
  onClose,
}: FilePreviewModalProps): ReactElement => {
  const isImage = isImagePath(filePath);
  const [textState, setTextState] = useState<TextState>({ status: "loading" });
  const [imageFailed, setImageFailed] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isImage) return;
    let cancelled = false;
    setTextState({ status: "loading" });
    void fetch(buildFileContentUrl(cwd, filePath))
      .then(async (response) => {
        if (cancelled) return;
        if (!response.ok) {
          setTextState({ status: "error", message: messageForStatus(response.status) });
          return;
        }
        const content = await response.text();
        if (cancelled) return;
        setTextState({ status: "ready", content });
      })
      .catch(() => {
        if (!cancelled) setTextState({ status: "error", message: "Couldn't load the file." });
      });
    return () => {
      cancelled = true;
    };
  }, [cwd, filePath, isImage]);

  useEffect(() => {
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const { directory, basename } = splitFilePath(filePath);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/10 supports-backdrop-filter:backdrop-blur-xs animate-in fade-in-0 duration-150 ease-snappy"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-label={`file preview ${filePath}`}
        aria-modal
        tabIndex={-1}
        className={cn(
          "relative z-10 flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl outline-none animate-in fade-in-0 zoom-in-95 duration-150 ease-snappy",
          MODAL_PANEL_CLASSES,
        )}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-border/40 px-3 py-2.5">
          <span className="min-w-0 flex-1 truncate font-mono text-xs">
            <span className="text-muted-foreground/60">{directory}</span>
            <span className="text-foreground">{basename}</span>
          </span>
          {isImage ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="open image in new tab"
              title="Open in new tab"
              onClick={() =>
                window.open(buildFileUrl(cwd, filePath), "_blank", "noopener,noreferrer")
              }
            >
              <ExternalLink className="size-4" aria-hidden="true" />
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="close"
            className="hover:text-foreground"
            onClick={onClose}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          {isImage ? (
            imageFailed ? (
              <PreviewError
                icon={<ImageOff className="size-5" aria-hidden="true" />}
                message="Couldn't load the image."
              />
            ) : (
              <img
                src={buildFileUrl(cwd, filePath)}
                alt={filePath}
                onError={() => setImageFailed(true)}
                className="mx-auto max-h-full max-w-full object-contain"
              />
            )
          ) : textState.status === "loading" ? (
            <div className="flex h-full items-center justify-center py-10">
              <Spinner className="size-4" aria-label="loading file" />
            </div>
          ) : textState.status === "error" ? (
            <PreviewError
              icon={<FileWarning className="size-5" aria-hidden="true" />}
              message={textState.message}
            />
          ) : (
            <pre className="whitespace-pre-wrap break-words rounded-md bg-foreground/5 p-2 font-mono text-[11px] leading-relaxed text-foreground/80">
              {textState.content}
            </pre>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};
