import type { GitDiffFileMeta } from "@monotykamary/localterm-server/protocol";
import { isImagePath } from "@monotykamary/localterm-server/protocol";
import { FileWarning } from "lucide-react";
import { useState, type ReactNode, type RefObject } from "react";
import { DiffChunk } from "@/components/diff-viewer-line-chunk-rendering";
import type { PendingAnnotationRange, PatchEntry } from "@/components/diff-viewer-types";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useFileDiffPaneState } from "@/hooks/use-file-diff-pane-state";
import { cn } from "@/lib/utils";
import { buildFileUrl } from "@/utils/build-file-url";
import type { DiffAnnotation } from "@/utils/format-review-prompt";
import type { SyntaxHighlightColorScheme } from "@/utils/syntax-highlight";
import type { DiffViewMode } from "@/utils/stored-diff-view-mode";

interface DiffPaneNoticeProps {
  children: ReactNode;
  icon?: boolean;
}

const DiffPaneNotice = ({ children, icon }: DiffPaneNoticeProps) => (
  <div className="flex h-full min-h-32 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
    {icon ? <FileWarning className="size-4" aria-hidden="true" /> : null}
    {children}
  </div>
);

// Inline image preview for binary image files. The bytes come straight from
// /api/file (not the patch payload), so it paints instantly on selection. A
// load failure — e.g. a deleted image whose working-tree file is gone — falls
// back to a notice instead of a lingering broken-image icon.
interface ImagePreviewProps {
  src: string;
  alt: string;
}

const ImagePreview = ({ src, alt }: ImagePreviewProps) => {
  const [failed, setFailed] = useState(false);
  if (failed) return <DiffPaneNotice icon>Couldn't load image preview.</DiffPaneNotice>;
  return (
    <div className="flex h-full min-h-32 items-center justify-center p-4">
      <img
        src={src}
        alt={alt}
        onError={() => setFailed(true)}
        className="max-h-full max-w-full rounded border border-border/40 object-contain"
      />
    </div>
  );
};

interface FileDiffPaneProps {
  file: GitDiffFileMeta;
  cwd: string | null;
  payload: PatchEntry;
  syntaxHighlightColorScheme: SyntaxHighlightColorScheme;
  viewMode: DiffViewMode;
  annotations: Record<string, DiffAnnotation>;
  editingKey: string | null;
  pendingRange: PendingAnnotationRange | null;
  // Set while a drag selection is active so the viewer's Escape handler can
  // cancel the drag instead of closing the dialog.
  dragCancelRef: RefObject<(() => void) | null>;
  onOpenEditor: (key: string, range?: PendingAnnotationRange) => void;
  onSaveAnnotation: (annotation: DiffAnnotation) => void;
  onCancelEditor: () => void;
  onDeleteAnnotation: (key: string) => void;
  onRetry: () => void;
}

// Mounted with key={file.path} by the parent, so switching files remounts it —
// renderLimit and any active drag reset cleanly, with no transition straddling
// two files.
export const FileDiffPane = ({
  file,
  cwd,
  payload,
  syntaxHighlightColorScheme,
  viewMode,
  annotations,
  editingKey,
  pendingRange,
  dragCancelRef,
  onOpenEditor,
  onSaveAnnotation,
  onCancelEditor,
  onDeleteAnnotation,
  onRetry,
}: FileDiffPaneProps) => {
  const patch = payload.data?.patch ?? null;
  const {
    scrollContainerRef,
    hunks,
    tokenMap,
    highlightingPending,
    visibleChunks,
    hiddenRows,
    isDragging,
    highlightedKeys,
    handleStartDrag,
    handleDragEnter,
  } = useFileDiffPaneState({
    filePath: file.path,
    patch,
    syntaxHighlightColorScheme,
    viewMode,
    annotations,
    pendingRange,
    dragCancelRef,
    onOpenEditor,
  });

  if (file.binary && isImagePath(file.path) && cwd) {
    return <ImagePreview src={buildFileUrl(cwd, file.path)} alt={file.path} />;
  }

  if (payload.state === "loading" && !payload.data) {
    return (
      <DiffPaneNotice>
        <Spinner className="size-4" aria-label="loading diff" />
        Loading diff…
      </DiffPaneNotice>
    );
  }
  if (payload.state === "error" || !payload.data) {
    return (
      <DiffPaneNotice icon>
        Couldn't load this file's diff.
        <Button variant="outline" size="xs" onClick={onRetry}>
          Retry
        </Button>
      </DiffPaneNotice>
    );
  }
  if (payload.data.binary) {
    return <DiffPaneNotice icon>Binary file — no text diff to show.</DiffPaneNotice>;
  }
  if (payload.data.patchOmitted) {
    return <DiffPaneNotice icon>Diff too large to display.</DiffPaneNotice>;
  }
  if (hunks.length === 0) {
    return (
      <DiffPaneNotice>
        {file.status === "renamed"
          ? "Renamed without content changes."
          : file.status === "untracked" && file.additions === 0
            ? "Empty file."
            : "No content changes."}
      </DiffPaneNotice>
    );
  }

  return (
    <div
      ref={scrollContainerRef}
      data-diff-scroll={viewMode === "split" ? "" : undefined}
      className={cn(
        "pb-4 font-mono text-xs leading-5",
        viewMode === "unified" && "min-w-max",
        isDragging && "select-none",
      )}
    >
      {visibleChunks.map((chunk) => (
        <DiffChunk
          key={chunk.key}
          chunk={chunk}
          filePath={file.path}
          tokenMap={tokenMap}
          highlightedKeys={highlightedKeys}
          annotations={annotations}
          editingKey={editingKey}
          pendingRange={pendingRange}
          highlightingPending={highlightingPending}
          onOpenEditor={onOpenEditor}
          onSaveAnnotation={onSaveAnnotation}
          onCancelEditor={onCancelEditor}
          onDeleteAnnotation={onDeleteAnnotation}
          onStartDrag={handleStartDrag}
          onDragEnter={handleDragEnter}
        />
      ))}
      {hiddenRows > 0 ? (
        <div className="flex items-center gap-2 px-4 py-2 text-muted-foreground/70">
          <Spinner className="size-3" aria-label="rendering diff" />
          rendering {hiddenRows.toLocaleString()} more lines…
        </div>
      ) : null}
    </div>
  );
};
