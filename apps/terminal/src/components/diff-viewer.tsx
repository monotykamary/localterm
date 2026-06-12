import type { GitDiffFile, GitDiffResponse } from "@monotykamary/localterm-server/protocol";
import {
  FileWarning,
  MessageSquare,
  MessageSquarePlus,
  Pencil,
  RefreshCw,
  Send,
  Trash2,
  X,
} from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  COMMAND_PALETTE_BACKDROP_CLASSES,
  COMMAND_PALETTE_PANEL_CLASSES,
  MODAL_PANEL_CLASSES,
} from "@/lib/animation-classes";
import { DIFF_VIEWER_CLOSE_TRANSITION_MS, DIFF_VIEWER_INITIAL_LINE_LIMIT } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { buildSplitDiffRows } from "@/utils/build-split-diff-rows";
import {
  buildDiffLineRangeIndex,
  coveredTargetKeys,
  diffLineTargetFor,
  diffLineTargetKey,
  resolveDragRange,
  type DiffLineRange,
  type DiffLineTarget,
} from "@/utils/diff-line-ranges";
import { fetchGitDiff } from "@/utils/fetch-git-diff";
import {
  annotationRangeStart,
  diffAnnotationKey,
  formatReviewPrompt,
  type DiffAnnotation,
} from "@/utils/format-review-prompt";
import {
  countHunkLines,
  parseUnifiedDiff,
  type DiffHunk,
  type DiffLine,
} from "@/utils/parse-unified-diff";
import {
  loadStoredDiffViewMode,
  storeDiffViewMode,
  type DiffViewMode,
} from "@/utils/stored-diff-view-mode";

interface DiffViewerProps {
  open: boolean;
  cwd: string | null;
  onClose: () => void;
  onSendToTerminal?: (text: string) => void;
}

// A multiline drag that just ended: the range the open annotation editor will
// attach to its annotation on save. `end` is the line the editor anchors to.
interface PendingAnnotationRange extends DiffLineRange {
  filePath: string;
}

const formatRangeLabel = (start: DiffLineTarget, end: DiffLineTarget): string => {
  const sideRef = (target: DiffLineTarget) =>
    `${target.side === "old" ? "old " : ""}L${target.lineNumber}`;
  return start.side === end.side
    ? `${start.side === "old" ? "old " : ""}L${start.lineNumber}–L${end.lineNumber}`
    : `${sideRef(start)} – ${sideRef(end)}`;
};

// Overlays a line covered by a multiline annotation or an in-progress drag
// selection. pointer-events-none keeps the line interactive beneath it.
const RangeHighlight = () => (
  <span
    aria-hidden="true"
    className="pointer-events-none absolute inset-0 border-l-2 border-primary/60 bg-primary/10"
  />
);

const STATUS_LABELS: Record<GitDiffFile["status"], { letter: string; className: string }> = {
  modified: { letter: "M", className: "text-amber-400" },
  added: { letter: "A", className: "text-emerald-400" },
  deleted: { letter: "D", className: "text-red-400" },
  renamed: { letter: "R", className: "text-sky-400" },
  untracked: { letter: "U", className: "text-emerald-400" },
};

const ADDITIONS_CLASSES = "text-emerald-400";
const DELETIONS_CLASSES = "text-red-400";

const LINE_NUMBER_CELL_CLASSES =
  "w-12 shrink-0 select-none px-2 text-right text-muted-foreground/50 tabular-nums";

const splitFilePath = (filePath: string): { directory: string; basename: string } => {
  const lastSlash = filePath.lastIndexOf("/");
  if (lastSlash === -1) return { directory: "", basename: filePath };
  return { directory: filePath.slice(0, lastSlash + 1), basename: filePath.slice(lastSlash + 1) };
};

const lineBackgroundClasses = (type: DiffLine["type"]): string => {
  if (type === "add") return "bg-emerald-500/10";
  if (type === "del") return "bg-red-500/10";
  return "";
};

const lineTextClasses = (type: DiffLine["type"]): string =>
  type === "context" ? "text-muted-foreground" : "text-foreground/90";

const AnnotateLineButton = ({
  onClick,
  onDragStart,
}: {
  onClick: () => void;
  onDragStart: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    onPointerDown={(event) => {
      if (event.button !== 0) return;
      // Keep the browser from starting a text selection under the drag.
      event.preventDefault();
      onDragStart();
    }}
    aria-label="comment on line — drag to select multiple lines"
    className="absolute top-1/2 left-1 z-10 hidden size-4 -translate-y-1/2 items-center justify-center rounded-sm bg-primary text-primary-foreground transition-transform group-hover/line:flex hover:scale-110"
  >
    <MessageSquarePlus className="size-3" aria-hidden="true" />
  </button>
);

interface AnnotationEditorProps {
  initialComment: string;
  onSave: (comment: string) => void;
  onCancel: () => void;
}

const AnnotationEditor = ({ initialComment, onSave, onCancel }: AnnotationEditorProps) => {
  const [comment, setComment] = useState(initialComment);
  const trimmed = comment.trim();
  const save = () => {
    if (trimmed) onSave(trimmed);
  };
  return (
    <div className="flex flex-col gap-2">
      <Textarea
        autoFocus
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            save();
          }
        }}
        placeholder="Leave a comment on this line…"
        aria-label="line comment"
        className="min-h-12 text-xs"
      />
      <div className="flex items-center gap-1.5">
        <Button size="xs" onClick={save} disabled={!trimmed}>
          Save comment
        </Button>
        <Button size="xs" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
};

interface AnnotationBlockProps {
  annotation: DiffAnnotation | undefined;
  isEditing: boolean;
  rangeLabel: string | null;
  onEdit: () => void;
  onSave: (comment: string) => void;
  onCancel: () => void;
  onDelete: () => void;
}

// Rendered as a full-width row right below the annotated diff line. The inner
// wrapper sticks to the left edge so it stays visible while the unified view
// scrolls horizontally.
const AnnotationBlock = ({
  annotation,
  isEditing,
  rangeLabel,
  onEdit,
  onSave,
  onCancel,
  onDelete,
}: AnnotationBlockProps) => (
  <div className="border-y border-border/40 bg-muted/20 py-2 pr-4 pl-3 font-sans">
    <div className="sticky left-3 max-w-xl">
      {rangeLabel ? (
        <div className="mb-1 font-mono text-[10px] tracking-wide text-muted-foreground/80">
          {rangeLabel}
        </div>
      ) : null}
      {isEditing ? (
        <AnnotationEditor
          initialComment={annotation?.comment ?? ""}
          onSave={onSave}
          onCancel={onCancel}
        />
      ) : annotation ? (
        <div className="group/comment flex items-start gap-2">
          <MessageSquare
            className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <p className="min-w-0 flex-1 whitespace-pre-wrap text-foreground/90">
            {annotation.comment}
          </p>
          <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/comment:opacity-100">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onEdit}
              aria-label="edit comment"
              className="hover:text-foreground"
            >
              <Pencil />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onDelete}
              aria-label="delete comment"
              className="hover:text-destructive"
            >
              <Trash2 />
            </Button>
          </span>
        </div>
      ) : null}
    </div>
  </div>
);

const UnifiedDiffLine = ({
  line,
  highlighted,
  onAnnotate,
  onDragStart,
  onDragEnter,
}: {
  line: DiffLine;
  highlighted: boolean;
  onAnnotate?: () => void;
  onDragStart?: () => void;
  onDragEnter?: () => void;
}) => (
  <div
    className={cn("group/line relative flex", lineBackgroundClasses(line.type))}
    onPointerEnter={onDragEnter}
  >
    {onAnnotate && onDragStart ? (
      <AnnotateLineButton onClick={onAnnotate} onDragStart={onDragStart} />
    ) : null}
    <span className={LINE_NUMBER_CELL_CLASSES}>{line.oldLine ?? ""}</span>
    <span className={LINE_NUMBER_CELL_CLASSES}>{line.newLine ?? ""}</span>
    <span
      className={cn(
        "w-5 shrink-0 select-none text-center",
        line.type === "add" && ADDITIONS_CLASSES,
        line.type === "del" && DELETIONS_CLASSES,
      )}
    >
      {line.type === "add" ? "+" : line.type === "del" ? "-" : ""}
    </span>
    <span className={cn("whitespace-pre pr-4", lineTextClasses(line.type))}>
      {line.text}
      {line.noNewline ? (
        <span className="select-none text-muted-foreground/50" title="No newline at end of file">
          {" ⊘"}
        </span>
      ) : null}
    </span>
    {highlighted ? <RangeHighlight /> : null}
  </div>
);

const SplitDiffCell = ({
  line,
  side,
  onAnnotate,
  onDragStart,
}: {
  line: DiffLine | null;
  side: "left" | "right";
  onAnnotate?: () => void;
  onDragStart?: () => void;
}) => {
  if (!line) {
    return (
      <>
        <span className={LINE_NUMBER_CELL_CLASSES} />
        <span className="min-w-0 flex-1 bg-muted/20" />
      </>
    );
  }
  // A context line renders on both sides; only color the side it changes.
  const effectiveType =
    line.type === "context" ? "context" : side === "left" ? "del" : ("add" as const);
  return (
    <>
      {onAnnotate && onDragStart ? (
        <AnnotateLineButton onClick={onAnnotate} onDragStart={onDragStart} />
      ) : null}
      <span className={cn(LINE_NUMBER_CELL_CLASSES, lineBackgroundClasses(effectiveType))}>
        {side === "left" ? (line.oldLine ?? "") : (line.newLine ?? "")}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 overflow-x-clip whitespace-pre pr-2",
          lineBackgroundClasses(effectiveType),
          lineTextClasses(line.type),
        )}
      >
        {line.text}
      </span>
    </>
  );
};

const HunkHeader = ({ hunk }: { hunk: DiffHunk }) => (
  <div className="select-none bg-muted/30 px-4 py-0.5 text-muted-foreground/60">{hunk.header}</div>
);

interface FileDiffPaneProps {
  file: GitDiffFile;
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
}

interface LineAnnotationState {
  key: string;
  target: DiffLineTarget;
  saved: DiffAnnotation | undefined;
  isEditing: boolean;
  rangeStart: DiffLineTarget | null;
  save: (comment: string) => void;
}

interface DragSelection {
  anchor: DiffLineTarget;
  focus: DiffLineTarget;
}

const FileDiffPane = ({
  file,
  viewMode,
  annotations,
  editingKey,
  pendingRange,
  dragCancelRef,
  onOpenEditor,
  onSaveAnnotation,
  onCancelEditor,
  onDeleteAnnotation,
}: FileDiffPaneProps) => {
  const [showAllLines, setShowAllLines] = useState(false);
  const [drag, setDrag] = useState<DragSelection | null>(null);
  const hunks = useMemo(() => (file.patch ? parseUnifiedDiff(file.patch) : []), [file.patch]);
  const totalLines = useMemo(() => countHunkLines(hunks), [hunks]);
  const rangeIndex = useMemo(() => buildDiffLineRangeIndex(hunks), [hunks]);

  const isDragging = drag !== null;
  const dragRange = drag ? resolveDragRange(rangeIndex, drag.anchor, drag.focus) : null;
  const dragRangeRef = useRef(dragRange);
  dragRangeRef.current = dragRange;

  const startDrag = (target: DiffLineTarget) => setDrag({ anchor: target, focus: target });
  const dragOver = (target: DiffLineTarget) =>
    setDrag((previous) => (previous ? { ...previous, focus: target } : previous));

  useEffect(() => {
    setShowAllLines(false);
    setDrag(null);
  }, [file.path]);

  // Releasing the pointer anywhere commits the drag and opens the editor on
  // the last line of the range; a plain click is just a single-line range.
  useEffect(() => {
    if (!isDragging) return;
    const cancelDrag = () => setDrag(null);
    dragCancelRef.current = cancelDrag;
    const commitDrag = () => {
      setDrag(null);
      const range = dragRangeRef.current;
      if (!range) return;
      const key = diffAnnotationKey({ filePath: file.path, ...range.end });
      const isMultiline = diffLineTargetKey(range.start) !== diffLineTargetKey(range.end);
      onOpenEditor(key, isMultiline ? { filePath: file.path, ...range } : undefined);
    };
    window.addEventListener("pointerup", commitDrag);
    window.addEventListener("pointercancel", cancelDrag);
    return () => {
      dragCancelRef.current = null;
      window.removeEventListener("pointerup", commitDrag);
      window.removeEventListener("pointercancel", cancelDrag);
    };
  }, [isDragging, file.path, onOpenEditor, dragCancelRef]);

  // Lines covered by the live drag, the just-committed editor range, or any
  // saved multiline annotation in this file.
  const highlightedKeys = useMemo(() => {
    const keys = new Set<string>();
    const addRange = (range: DiffLineRange | null) => {
      if (!range) return;
      for (const key of coveredTargetKeys(rangeIndex, range)) keys.add(key);
    };
    addRange(dragRange);
    if (pendingRange && pendingRange.filePath === file.path) addRange(pendingRange);
    for (const annotation of Object.values(annotations)) {
      if (annotation.filePath !== file.path) continue;
      const start = annotationRangeStart(annotation);
      if (start) {
        addRange({ start, end: { side: annotation.side, lineNumber: annotation.lineNumber } });
      }
    }
    return keys;
  }, [rangeIndex, dragRange, pendingRange, annotations, file.path]);

  if (file.binary) {
    return <DiffPaneNotice icon>Binary file — no text diff to show.</DiffPaneNotice>;
  }
  if (file.patchOmitted) {
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

  const lineLimit = showAllLines ? Number.POSITIVE_INFINITY : DIFF_VIEWER_INITIAL_LINE_LIMIT;
  let renderedLines = 0;
  const visibleHunks: DiffHunk[] = [];
  for (const hunk of hunks) {
    if (renderedLines >= lineLimit) break;
    const remaining = lineLimit - renderedLines;
    const lines = hunk.lines.length <= remaining ? hunk.lines : hunk.lines.slice(0, remaining);
    visibleHunks.push(lines === hunk.lines ? hunk : { header: hunk.header, lines });
    renderedLines += lines.length;
  }
  const hiddenLineCount = totalLines - renderedLines;

  const annotationStateFor = (line: DiffLine): LineAnnotationState | null => {
    const target = diffLineTargetFor(line);
    if (!target) return null;
    const key = diffAnnotationKey({ filePath: file.path, ...target });
    const saved = annotations[key];
    const isEditing = editingKey === key;
    // A drag that just ended supplies the editor's range; re-editing an
    // existing multiline annotation keeps its saved range.
    const rangeStart =
      isEditing && pendingRange && pendingRange.filePath === file.path
        ? pendingRange.start
        : saved
          ? annotationRangeStart(saved)
          : null;
    return {
      key,
      target,
      saved,
      isEditing,
      rangeStart,
      save: (comment: string) =>
        onSaveAnnotation({
          filePath: file.path,
          ...target,
          ...(rangeStart
            ? { startSide: rangeStart.side, startLineNumber: rangeStart.lineNumber }
            : {}),
          comment,
        }),
    };
  };

  const renderAnnotation = (state: LineAnnotationState | null) =>
    state && (state.saved || state.isEditing) ? (
      <AnnotationBlock
        annotation={state.saved}
        isEditing={state.isEditing}
        rangeLabel={state.rangeStart ? formatRangeLabel(state.rangeStart, state.target) : null}
        onEdit={() => onOpenEditor(state.key)}
        onSave={state.save}
        onCancel={onCancelEditor}
        onDelete={() => onDeleteAnnotation(state.key)}
      />
    ) : null;

  return (
    <div
      className={cn(
        "pb-4 font-mono text-xs leading-5",
        // Unified lines scroll horizontally; split columns clip instead so the
        // two panes keep a stable 50/50 width.
        viewMode === "unified" && "min-w-max",
        isDragging && "select-none",
      )}
    >
      {visibleHunks.map((hunk) => (
        <div key={hunk.header + String(hunk.lines[0]?.newLine ?? hunk.lines[0]?.oldLine ?? "")}>
          <HunkHeader hunk={hunk} />
          {viewMode === "unified"
            ? hunk.lines.map((line, lineIndex) => {
                const state = annotationStateFor(line);
                return (
                  <Fragment key={lineIndex}>
                    <UnifiedDiffLine
                      line={line}
                      highlighted={
                        state !== null && highlightedKeys.has(diffLineTargetKey(state.target))
                      }
                      onAnnotate={state ? () => onOpenEditor(state.key) : undefined}
                      onDragStart={state ? () => startDrag(state.target) : undefined}
                      onDragEnter={
                        isDragging && state ? () => dragOver(state.target) : undefined
                      }
                    />
                    {renderAnnotation(state)}
                  </Fragment>
                );
              })
            : buildSplitDiffRows(hunk).map((row, rowIndex) => {
                const leftState = row.left ? annotationStateFor(row.left) : null;
                const rightState = row.right ? annotationStateFor(row.right) : null;
                // A context line is the same object on both sides — render its
                // annotation once.
                const isSharedAnnotation = leftState !== null && leftState.key === rightState?.key;
                return (
                  <Fragment key={rowIndex}>
                    <div className="flex">
                      <div
                        className="group/line relative flex w-1/2 min-w-0 border-r border-border/40"
                        onPointerEnter={
                          isDragging && leftState ? () => dragOver(leftState.target) : undefined
                        }
                      >
                        <SplitDiffCell
                          line={row.left}
                          side="left"
                          onAnnotate={leftState ? () => onOpenEditor(leftState.key) : undefined}
                          onDragStart={leftState ? () => startDrag(leftState.target) : undefined}
                        />
                        {leftState && highlightedKeys.has(diffLineTargetKey(leftState.target)) ? (
                          <RangeHighlight />
                        ) : null}
                      </div>
                      <div
                        className="group/line relative flex w-1/2 min-w-0"
                        onPointerEnter={
                          isDragging && rightState ? () => dragOver(rightState.target) : undefined
                        }
                      >
                        <SplitDiffCell
                          line={row.right}
                          side="right"
                          onAnnotate={rightState ? () => onOpenEditor(rightState.key) : undefined}
                          onDragStart={rightState ? () => startDrag(rightState.target) : undefined}
                        />
                        {rightState && highlightedKeys.has(diffLineTargetKey(rightState.target)) ? (
                          <RangeHighlight />
                        ) : null}
                      </div>
                    </div>
                    {renderAnnotation(leftState)}
                    {isSharedAnnotation ? null : renderAnnotation(rightState)}
                  </Fragment>
                );
              })}
        </div>
      ))}
      {hiddenLineCount > 0 ? (
        <div className="px-4 py-2">
          <Button variant="outline" size="xs" onClick={() => setShowAllLines(true)}>
            Show {hiddenLineCount.toLocaleString()} more lines
          </Button>
        </div>
      ) : null}
    </div>
  );
};

const DiffPaneNotice = ({ children, icon }: { children: React.ReactNode; icon?: boolean }) => (
  <div className="flex h-full min-h-32 items-center justify-center gap-2 text-sm text-muted-foreground">
    {icon ? <FileWarning className="size-4" aria-hidden="true" /> : null}
    {children}
  </div>
);

export const DiffViewer = ({ open, cwd, onClose, onSendToTerminal }: DiffViewerProps) => {
  const [mounted, setMounted] = useState(false);
  const [settled, setSettled] = useState(false);
  const [diff, setDiff] = useState<GitDiffResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<DiffViewMode>(() => loadStoredDiffViewMode());
  const [refreshCount, setRefreshCount] = useState(0);
  // Pending review annotations survive close/reopen until they are sent.
  const [annotations, setAnnotations] = useState<Record<string, DiffAnnotation>>({});
  const [editingKey, setEditingKey] = useState<string | null>(null);
  // Range selected by the drag that opened the current editor, applied to the
  // annotation on save.
  const [pendingRange, setPendingRange] = useState<PendingAnnotationRange | null>(null);
  const dragCancelRef = useRef<(() => void) | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const fileListRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const frame = requestAnimationFrame(() => setSettled(true));
      return () => cancelAnimationFrame(frame);
    }
    setSettled(false);
    if (mounted) {
      const timer = window.setTimeout(() => setMounted(false), DIFF_VIEWER_CLOSE_TRANSITION_MS);
      return () => window.clearTimeout(timer);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !cwd) return;
    const controller = new AbortController();
    setIsLoading(true);
    setHasError(false);
    void fetchGitDiff(cwd, controller.signal).then((response) => {
      if (controller.signal.aborted) return;
      setIsLoading(false);
      if (!response) {
        setHasError(true);
        return;
      }
      setDiff(response);
    });
    return () => controller.abort();
  }, [open, cwd, refreshCount]);

  const files = diff?.files ?? [];

  // Keep a valid selection: follow the current file across refreshes, fall
  // back to the first file when it disappears.
  useEffect(() => {
    if (!diff) return;
    if (selectedPath && diff.files.some((file) => file.path === selectedPath)) return;
    setSelectedPath(diff.files[0]?.path ?? null);
  }, [diff, selectedPath]);

  const selectedFile = files.find((file) => file.path === selectedPath) ?? null;
  const selectedIndex = selectedFile ? files.indexOf(selectedFile) : -1;

  const totals = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    let binaries = 0;
    for (const file of files) {
      additions += file.additions;
      deletions += file.deletions;
      if (file.binary) binaries += 1;
    }
    return { additions, deletions, binaries };
  }, [files]);

  const moveSelection = useCallback(
    (delta: number) => {
      if (files.length === 0) return;
      const nextIndex = Math.min(
        files.length - 1,
        Math.max(0, (selectedIndex === -1 ? 0 : selectedIndex) + delta),
      );
      setSelectedPath(files[nextIndex].path);
      const item = fileListRef.current?.children[nextIndex] as HTMLElement | undefined;
      item?.scrollIntoView({ block: "nearest" });
    },
    [files, selectedIndex],
  );

  useEffect(() => {
    if (!open || !mounted) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      // The annotation editor's textarea handles Escape itself (closes just
      // the editor) and owns all typing.
      const isTextArea = target instanceof HTMLElement && target.tagName === "TEXTAREA";
      if (event.key === "Escape") {
        if (isTextArea) return;
        event.preventDefault();
        event.stopPropagation();
        // Mid-drag Escape abandons the range selection, not the viewer.
        if (dragCancelRef.current) {
          dragCancelRef.current();
          return;
        }
        onClose();
        return;
      }
      if (isTextArea) return;
      if (target instanceof HTMLElement && target.tagName === "INPUT") return;
      if (event.key === "ArrowDown" || event.key === "j") {
        event.preventDefault();
        moveSelection(1);
      } else if (event.key === "ArrowUp" || event.key === "k") {
        event.preventDefault();
        moveSelection(-1);
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [open, mounted, onClose, moveSelection]);

  useEffect(() => {
    if (open && settled) panelRef.current?.focus();
  }, [open, settled]);

  const handleViewModeChange = useCallback((nextMode: DiffViewMode) => {
    setViewMode(nextMode);
    storeDiffViewMode(nextMode);
  }, []);

  const openAnnotationEditor = useCallback((key: string, range?: PendingAnnotationRange) => {
    setEditingKey(key);
    setPendingRange(range ?? null);
  }, []);

  const cancelAnnotationEditor = useCallback(() => {
    setEditingKey(null);
    setPendingRange(null);
  }, []);

  const saveAnnotation = useCallback((annotation: DiffAnnotation) => {
    setAnnotations((previous) => ({ ...previous, [diffAnnotationKey(annotation)]: annotation }));
    setEditingKey(null);
    setPendingRange(null);
  }, []);

  const deleteAnnotation = useCallback((key: string) => {
    setAnnotations((previous) => {
      const { [key]: _removed, ...rest } = previous;
      return rest;
    });
    setEditingKey((previous) => (previous === key ? null : previous));
    setPendingRange((previous) =>
      previous && diffAnnotationKey({ filePath: previous.filePath, ...previous.end }) === key
        ? null
        : previous,
    );
  }, []);

  const annotationList = useMemo(() => Object.values(annotations), [annotations]);

  const annotationCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const annotation of annotationList) {
      counts.set(annotation.filePath, (counts.get(annotation.filePath) ?? 0) + 1);
    }
    return counts;
  }, [annotationList]);

  const clearAnnotations = useCallback(() => {
    setAnnotations({});
    setEditingKey(null);
    setPendingRange(null);
  }, []);

  const handleSendToTerminal = useCallback(() => {
    if (!onSendToTerminal || annotationList.length === 0) return;
    onSendToTerminal(formatReviewPrompt(annotationList));
    setAnnotations({});
    setEditingKey(null);
    setPendingRange(null);
    onClose();
  }, [onSendToTerminal, annotationList, onClose]);

  if (!mounted) return null;

  const isVisible = open && settled;
  const isRepo = diff?.isRepo ?? true;
  const isEmpty = diff !== null && isRepo && files.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <div
        data-open={isVisible || undefined}
        data-closed={!isVisible || undefined}
        className={cn(COMMAND_PALETTE_BACKDROP_CLASSES)}
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-label="git diff viewer"
        aria-modal
        tabIndex={-1}
        data-open={isVisible || undefined}
        data-closed={!isVisible || undefined}
        className={cn(
          "relative z-10 flex h-full w-full max-w-7xl flex-col overflow-hidden rounded-xl outline-none",
          MODAL_PANEL_CLASSES,
          COMMAND_PALETTE_PANEL_CLASSES,
        )}
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-border/40 px-4 py-2.5">
          <h2 className="text-sm font-medium text-foreground">Changes</h2>
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            <span className={ADDITIONS_CLASSES}>+{totals.additions.toLocaleString()}</span>{" "}
            <span className={DELETIONS_CLASSES}>−{totals.deletions.toLocaleString()}</span>
            {totals.binaries > 0 ? (
              <span className="text-muted-foreground/70"> · {totals.binaries} binary</span>
            ) : null}
          </span>
          {isLoading ? <Spinner className="size-3.5" aria-label="loading diff" /> : null}
          <div className="ml-auto flex items-center gap-1">
            <div
              role="radiogroup"
              aria-label="diff layout"
              className="flex items-center rounded-md border border-border/60 p-0.5"
            >
              {(["unified", "split"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={viewMode === mode}
                  onClick={() => handleViewModeChange(mode)}
                  className={cn(
                    "rounded-sm px-2 py-0.5 text-xs capitalize transition-colors",
                    viewMode === mode
                      ? "bg-foreground/10 text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {mode}
                </button>
              ))}
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setRefreshCount((count) => count + 1)}
              aria-label="refresh diff"
              className="hover:text-foreground"
            >
              <RefreshCw />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              aria-label="close diff viewer"
              className="hover:text-foreground"
            >
              <X />
            </Button>
          </div>
        </header>

        {hasError ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
            Couldn't load the diff from the localterm daemon.
            <Button
              variant="outline"
              size="xs"
              onClick={() => setRefreshCount((count) => count + 1)}
            >
              Retry
            </Button>
          </div>
        ) : !isRepo ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Not a git repository.
          </div>
        ) : isEmpty ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Working tree clean — nothing to diff.
          </div>
        ) : diff === null ? (
          <div className="flex flex-1 items-center justify-center">
            <Spinner aria-label="loading diff" />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1">
            <div
              ref={fileListRef}
              role="listbox"
              aria-label="changed files"
              className="w-72 shrink-0 overflow-y-auto overscroll-contain border-r border-border/40 p-1.5"
            >
              {files.map((file) => {
                const status = STATUS_LABELS[file.status];
                const { directory, basename } = splitFilePath(file.path);
                const isSelected = file.path === selectedPath;
                const commentCount = annotationCounts.get(file.path) ?? 0;
                return (
                  <button
                    key={file.path}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => setSelectedPath(file.path)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs outline-none transition-colors",
                      isSelected
                        ? "bg-foreground/10 text-foreground"
                        : "text-muted-foreground hover:bg-foreground/5",
                    )}
                  >
                    <span
                      className={cn("w-3 shrink-0 font-mono font-semibold", status.className)}
                      title={file.status}
                    >
                      {status.letter}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono" dir="rtl">
                      <bdi>
                        <span className="text-muted-foreground/60">{directory}</span>
                        <span className={isSelected ? "text-foreground" : ""}>{basename}</span>
                      </bdi>
                    </span>
                    {commentCount > 0 ? (
                      <span
                        className="flex shrink-0 items-center gap-0.5 font-mono text-[10px] tabular-nums text-muted-foreground"
                        title={`${commentCount} pending comment${commentCount === 1 ? "" : "s"}`}
                      >
                        <MessageSquare className="size-2.5" aria-hidden="true" />
                        {commentCount}
                      </span>
                    ) : null}
                    {file.binary ? (
                      <span className="shrink-0 rounded border border-border/40 px-1 font-mono text-[10px] text-muted-foreground/70">
                        BIN
                      </span>
                    ) : (
                      <span className="shrink-0 font-mono tabular-nums">
                        <span className={ADDITIONS_CLASSES}>+{file.additions}</span>{" "}
                        <span className={DELETIONS_CLASSES}>−{file.deletions}</span>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              {selectedFile ? (
                <>
                  <div className="flex shrink-0 items-center gap-2 border-b border-border/40 px-4 py-1.5 font-mono text-xs text-muted-foreground">
                    {selectedFile.oldPath ? (
                      <span className="truncate">
                        {selectedFile.oldPath}
                        <span className="text-muted-foreground/50"> → </span>
                        <span className="text-foreground">{selectedFile.path}</span>
                      </span>
                    ) : (
                      <span className="truncate text-foreground">{selectedFile.path}</span>
                    )}
                    {!selectedFile.binary ? (
                      <span className="ml-auto shrink-0 tabular-nums">
                        <span className={ADDITIONS_CLASSES}>+{selectedFile.additions}</span>{" "}
                        <span className={DELETIONS_CLASSES}>−{selectedFile.deletions}</span>
                      </span>
                    ) : null}
                  </div>
                  <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
                    <FileDiffPane
                      file={selectedFile}
                      viewMode={viewMode}
                      annotations={annotations}
                      editingKey={editingKey}
                      pendingRange={pendingRange}
                      dragCancelRef={dragCancelRef}
                      onOpenEditor={openAnnotationEditor}
                      onSaveAnnotation={saveAnnotation}
                      onCancelEditor={cancelAnnotationEditor}
                      onDeleteAnnotation={deleteAnnotation}
                    />
                  </div>
                </>
              ) : (
                <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                  Select a file to view its diff.
                </div>
              )}
            </div>
          </div>
        )}

        {annotationList.length > 0 ? (
          <footer className="flex shrink-0 items-center gap-2 border-t border-border/40 px-4 py-2">
            <span className="text-xs text-muted-foreground">
              {annotationList.length} pending comment{annotationList.length === 1 ? "" : "s"}
            </span>
            <div className="ml-auto flex items-center gap-1.5">
              <Button variant="ghost" size="xs" onClick={clearAnnotations}>
                Clear all
              </Button>
              {onSendToTerminal ? (
                <Button size="xs" onClick={handleSendToTerminal}>
                  <Send aria-hidden="true" />
                  Send to terminal
                </Button>
              ) : null}
            </div>
          </footer>
        ) : null}
      </div>
    </div>
  );
};
