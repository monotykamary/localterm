import type {
  GitBranchInfo,
  GitBranchPr,
  GitDiffFileListResponse,
  GitDiffFileMeta,
  GitDiffFilePatch,
  GitDiffMode,
} from "@monotykamary/localterm-server/protocol";
import type { SyntaxLine } from "@/utils/syntax-highlight";
import {
  FileWarning,
  GitBranch,
  GitPullRequest,
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
  memo,
  startTransition,
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
import {
  DIFF_VIEWER_CLOSE_TRANSITION_MS,
  DIFF_VIEWER_INITIAL_LINE_LIMIT,
  DIFF_VIEWER_RENDER_CHUNK,
} from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { SplitDiffRow } from "@/utils/build-split-diff-rows";
import { renderSyntaxTokens } from "@/utils/render-syntax-tokens";
import {
  detectLangId,
  getCachedTokens,
  prefetchTokens,
  tokenizeDiffLines,
} from "@/utils/syntax-highlight";
import {
  buildRenderChunks,
  renderChunkLength,
  type RenderChunk,
} from "@/utils/build-render-chunks";
import {
  buildDiffLineRangeIndex,
  coveredTargetKeys,
  diffLineTargetFor,
  diffLineTargetKey,
  resolveDragRange,
  type DiffLineRange,
  type DiffLineTarget,
} from "@/utils/diff-line-ranges";
import { PR_STATE_STYLES } from "@/lib/pr-state-styles";
import { fetchGitDiffFilePatch, fetchGitDiffFiles } from "@/utils/fetch-git-diff";
import {
  annotationRangeStart,
  diffAnnotationKey,
  formatReviewPrompt,
  type DiffAnnotation,
} from "@/utils/format-review-prompt";
import { parseUnifiedDiff, type DiffLine } from "@/utils/parse-unified-diff";
import {
  loadStoredDiffViewMode,
  storeDiffViewMode,
  type DiffViewMode,
} from "@/utils/stored-diff-view-mode";

interface DiffViewerProps {
  open: boolean;
  cwd: string | null;
  // Ambient branch/PR metadata leased from the parent (fetched once per cwd), so
  // the viewer opens straight into branch mode when a PR exists — no gh wait.
  // Null while the lease is still loading or unavailable.
  branchInfo: GitBranchInfo | null;
  onClose: () => void;
  onSendToTerminal?: (text: string) => void;
  // Ask the parent to re-fetch the leased branch info (wired to the refresh
  // button alongside re-fetching the diff).
  onRefreshBranchInfo?: () => void;
}

// A multiline drag that just ended: the range the open annotation editor will
// attach to its annotation on save. `end` is the line the editor anchors to.
interface PendingAnnotationRange extends DiffLineRange {
  filePath: string;
}

// Per-file patch fetched lazily when a file is selected.
interface PatchEntry {
  state: "loading" | "loaded" | "error";
  data?: GitDiffFilePatch;
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

const STATUS_LABELS: Record<GitDiffFileMeta["status"], { letter: string; className: string }> = {
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

// Stable per-line callbacks (defined once in FileDiffPane) take the line/key as
// an argument so the leaf row components below can be memoized: during the
// progressive grow, an already-mounted line keeps identical props and bails out.
interface LineCallbacks {
  onAnnotate?: (key: string) => void;
  onStartDrag?: (line: DiffLine) => void;
  onDragEnter?: (line: DiffLine) => void;
}

const UnifiedDiffLine = memo(
  ({
    line,
    annotateKey,
    highlighted,
    syntaxTokens,
    onAnnotate,
    onStartDrag,
    onDragEnter,
  }: {
    line: DiffLine;
    annotateKey: string | null;
    highlighted: boolean;
    syntaxTokens: SyntaxLine | null;
  } & LineCallbacks) => (
    <div
      className={cn("group/line relative flex", lineBackgroundClasses(line.type))}
      onPointerEnter={onDragEnter ? () => onDragEnter(line) : undefined}
    >
      {annotateKey !== null && onAnnotate && onStartDrag ? (
        <AnnotateLineButton
          onClick={() => onAnnotate(annotateKey)}
          onDragStart={() => onStartDrag(line)}
        />
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
      <span className={cn("whitespace-pre pr-4", !syntaxTokens && lineTextClasses(line.type))}>
        {syntaxTokens ? renderSyntaxTokens(syntaxTokens.tokens) : line.text}
        {line.noNewline ? (
          <span className="select-none text-muted-foreground/50" title="No newline at end of file">
            {" ⊘"}
          </span>
        ) : null}
      </span>
      {highlighted ? <RangeHighlight /> : null}
    </div>
  ),
);
UnifiedDiffLine.displayName = "UnifiedDiffLine";

const SplitDiffCell = ({
  line,
  side,
  syntaxTokens,
  onAnnotate,
  onDragStart,
}: {
  line: DiffLine | null;
  side: "left" | "right";
  syntaxTokens: SyntaxLine | null;
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
          !syntaxTokens && lineTextClasses(line.type),
        )}
      >
        {syntaxTokens ? renderSyntaxTokens(syntaxTokens.tokens) : line.text}
      </span>
    </>
  );
};

const SplitDiffRowView = memo(
  ({
    row,
    leftKey,
    leftHighlighted,
    rightKey,
    rightHighlighted,
    tokenMap,
    onAnnotate,
    onStartDrag,
    onDragEnter,
  }: {
    row: SplitDiffRow;
    leftKey: string | null;
    leftHighlighted: boolean;
    rightKey: string | null;
    rightHighlighted: boolean;
    tokenMap: Map<DiffLine, SyntaxLine>;
  } & LineCallbacks) => {
    const left = row.left;
    const right = row.right;
    return (
      <div className="flex">
        <div
          className="group/line relative flex w-1/2 min-w-0 border-r border-border/40"
          onPointerEnter={onDragEnter && left ? () => onDragEnter(left) : undefined}
        >
          <SplitDiffCell
            line={left}
            side="left"
            syntaxTokens={left ? (tokenMap.get(left) ?? null) : null}
            onAnnotate={leftKey !== null && onAnnotate ? () => onAnnotate(leftKey) : undefined}
            onDragStart={left && onStartDrag ? () => onStartDrag(left) : undefined}
          />
          {leftHighlighted ? <RangeHighlight /> : null}
        </div>
        <div
          className="group/line relative flex w-1/2 min-w-0"
          onPointerEnter={onDragEnter && right ? () => onDragEnter(right) : undefined}
        >
          <SplitDiffCell
            line={right}
            side="right"
            syntaxTokens={right ? (tokenMap.get(right) ?? null) : null}
            onAnnotate={rightKey !== null && onAnnotate ? () => onAnnotate(rightKey) : undefined}
            onDragStart={right && onStartDrag ? () => onStartDrag(right) : undefined}
          />
          {rightHighlighted ? <RangeHighlight /> : null}
        </div>
      </div>
    );
  },
);
SplitDiffRowView.displayName = "SplitDiffRowView";

const HunkHeader = ({ header }: { header: string }) => (
  <div className="select-none bg-muted/30 px-4 py-0.5 text-muted-foreground/60">{header}</div>
);

interface DiffChunkProps {
  chunk: RenderChunk;
  filePath: string;
  tokenMap: Map<DiffLine, SyntaxLine>;
  highlightedKeys: ReadonlySet<string>;
  annotations: Record<string, DiffAnnotation>;
  editingKey: string | null;
  pendingRange: PendingAnnotationRange | null;
  onOpenEditor: (key: string, range?: PendingAnnotationRange) => void;
  onSaveAnnotation: (annotation: DiffAnnotation) => void;
  onCancelEditor: () => void;
  onDeleteAnnotation: (key: string) => void;
  onStartDrag: (line: DiffLine) => void;
  onDragEnter: (line: DiffLine) => void;
}

// One rendered slice of the diff. Memoized: during the progressive grow every
// prop is referentially stable for already-mounted chunks, so only the newly
// revealed chunk renders (keeps growth O(chunk), not O(total)).
const DiffChunk = memo((props: DiffChunkProps) => {
  const {
    chunk,
    filePath,
    tokenMap,
    highlightedKeys,
    annotations,
    editingKey,
    pendingRange,
    onOpenEditor,
    onSaveAnnotation,
    onCancelEditor,
    onDeleteAnnotation,
    onStartDrag,
    onDragEnter,
  } = props;

  const annotationStateFor = (line: DiffLine): LineAnnotationState | null => {
    const target = diffLineTargetFor(line);
    if (!target) return null;
    const key = diffAnnotationKey({ filePath, ...target });
    const saved = annotations[key];
    const isEditing = editingKey === key;
    // A drag that just ended supplies the editor's range; re-editing an existing
    // multiline annotation keeps its saved range.
    const rangeStart =
      isEditing && pendingRange && pendingRange.filePath === filePath
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
          filePath,
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
    <div>
      {chunk.header !== null ? <HunkHeader header={chunk.header} /> : null}
      {chunk.mode === "unified"
        ? chunk.lines.map((line, lineIndex) => {
            const state = annotationStateFor(line);
            return (
              <Fragment key={lineIndex}>
                <UnifiedDiffLine
                  line={line}
                  annotateKey={state ? state.key : null}
                  highlighted={
                    state !== null && highlightedKeys.has(diffLineTargetKey(state.target))
                  }
                  syntaxTokens={tokenMap.get(line) ?? null}
                  onAnnotate={onOpenEditor}
                  onStartDrag={onStartDrag}
                  onDragEnter={onDragEnter}
                />
                {renderAnnotation(state)}
              </Fragment>
            );
          })
        : chunk.rows.map((row, rowIndex) => {
            const leftState = row.left ? annotationStateFor(row.left) : null;
            const rightState = row.right ? annotationStateFor(row.right) : null;
            // A context line is the same object on both sides — render its
            // annotation once.
            const isSharedAnnotation = leftState !== null && leftState.key === rightState?.key;
            return (
              <Fragment key={rowIndex}>
                <SplitDiffRowView
                  row={row}
                  leftKey={leftState ? leftState.key : null}
                  leftHighlighted={
                    leftState !== null && highlightedKeys.has(diffLineTargetKey(leftState.target))
                  }
                  rightKey={rightState ? rightState.key : null}
                  rightHighlighted={
                    rightState !== null && highlightedKeys.has(diffLineTargetKey(rightState.target))
                  }
                  tokenMap={tokenMap}
                  onAnnotate={onOpenEditor}
                  onStartDrag={onStartDrag}
                  onDragEnter={onDragEnter}
                />
                {renderAnnotation(leftState)}
                {isSharedAnnotation ? null : renderAnnotation(rightState)}
              </Fragment>
            );
          })}
    </div>
  );
});
DiffChunk.displayName = "DiffChunk";

const DiffPaneNotice = ({ children, icon }: { children: React.ReactNode; icon?: boolean }) => (
  <div className="flex h-full min-h-32 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
    {icon ? <FileWarning className="size-4" aria-hidden="true" /> : null}
    {children}
  </div>
);

interface FileDiffPaneProps {
  file: GitDiffFileMeta;
  payload: PatchEntry;
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
const FileDiffPane = ({
  file,
  payload,
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
  const [renderLimit, setRenderLimit] = useState(DIFF_VIEWER_INITIAL_LINE_LIMIT);
  const [drag, setDrag] = useState<DragSelection | null>(null);
  const hunks = useMemo(() => (patch ? parseUnifiedDiff(patch) : []), [patch]);
  const rangeIndex = useMemo(() => buildDiffLineRangeIndex(hunks), [hunks]);

  const [syntaxResult, setSyntaxResult] = useState<readonly SyntaxLine[] | null | undefined>(() => {
    if (!patch) return undefined;
    const initialHunks = parseUnifiedDiff(patch);
    const langId = detectLangId(file.path);
    if (!langId || initialHunks.length === 0) return null;
    const allLines = initialHunks.flatMap((hunk) => hunk.lines);
    const texts = allLines.map((line) => line.text);
    return getCachedTokens(file.path, texts);
  });

  const tokenMap = useMemo(() => {
    if (syntaxResult === undefined || syntaxResult === null) return new Map<DiffLine, SyntaxLine>();
    const allLines = hunks.flatMap((hunk) => hunk.lines);
    const map = new Map<DiffLine, SyntaxLine>();
    for (let index = 0; index < allLines.length; index += 1) {
      if (syntaxResult[index]) map.set(allLines[index], syntaxResult[index]);
    }
    return map;
  }, [syntaxResult, hunks]);

  useEffect(() => {
    const langId = detectLangId(file.path);
    if (!langId || hunks.length === 0) {
      setSyntaxResult(null);
      return;
    }
    const allLines = hunks.flatMap((hunk) => hunk.lines);
    if (allLines.length === 0) {
      setSyntaxResult(null);
      return;
    }
    const texts = allLines.map((line) => line.text);
    const cached = getCachedTokens(file.path, texts);
    if (cached !== undefined) {
      setSyntaxResult(cached);
      return;
    }
    let cancelled = false;
    tokenizeDiffLines(file.path, texts, langId).then((result) => {
      if (cancelled) return;
      startTransition(() => setSyntaxResult(result));
    });
    return () => {
      cancelled = true;
    };
  }, [file.path, hunks]);
  const renderChunks = useMemo(
    () => buildRenderChunks(hunks, viewMode, DIFF_VIEWER_RENDER_CHUNK),
    [hunks, viewMode],
  );
  const totalRenderRows = useMemo(
    () => renderChunks.reduce((total, chunk) => total + renderChunkLength(chunk), 0),
    [renderChunks],
  );
  const visibleChunks = useMemo(
    () => renderChunks.filter((chunk) => chunk.startIndex < renderLimit),
    [renderChunks, renderLimit],
  );
  const renderedRows = useMemo(
    () => visibleChunks.reduce((total, chunk) => total + renderChunkLength(chunk), 0),
    [visibleChunks],
  );

  const isDragging = drag !== null;
  const isDraggingRef = useRef(isDragging);
  isDraggingRef.current = isDragging;
  const dragRange = drag ? resolveDragRange(rangeIndex, drag.anchor, drag.focus) : null;
  const dragRangeRef = useRef(dragRange);
  dragRangeRef.current = dragRange;

  // Stable across renders so memoized rows bail out during the grow; identity is
  // gated on a ref instead of `isDragging` so starting a drag doesn't churn props.
  const handleStartDrag = useCallback((line: DiffLine) => {
    const target = diffLineTargetFor(line);
    if (target) setDrag({ anchor: target, focus: target });
  }, []);
  const handleDragEnter = useCallback((line: DiffLine) => {
    if (!isDraggingRef.current) return;
    const target = diffLineTargetFor(line);
    if (target) setDrag((previous) => (previous ? { ...previous, focus: target } : previous));
  }, []);

  // Reveal one more chunk per frame until the whole file is rendered. Wrapped in
  // a transition so streaming the tail never blocks pointer/scroll/keyboard input.
  useEffect(() => {
    if (renderLimit >= totalRenderRows) return;
    const frame = requestAnimationFrame(() => {
      startTransition(() =>
        setRenderLimit((limit) => Math.min(totalRenderRows, limit + DIFF_VIEWER_RENDER_CHUNK)),
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [renderLimit, totalRenderRows]);

  // Releasing the pointer anywhere commits the drag and opens the editor on the
  // last line of the range; a plain click is just a single-line range.
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

  // Lines covered by the live drag, the just-committed editor range, or any saved
  // multiline annotation in this file.
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

  const hiddenRows = totalRenderRows - renderedRows;

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

// "This branch has a GitHub PR" chip — color-coded by state and set apart from
// the add/delete greens and reds so a detected PR is obvious at a glance. Links
// to the PR when gh gave us a URL.
const PrBadge = ({ pr }: { pr: GitBranchPr }) => {
  const style = PR_STATE_STYLES[pr.state];
  const className = cn(
    "inline-flex max-w-64 shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px] transition-colors",
    style.badge,
  );
  const label = `PR #${pr.number} (${pr.state})${pr.title ? ` — ${pr.title}` : ""}`;
  const content = (
    <>
      <GitPullRequest className="size-3 shrink-0" aria-hidden="true" />
      <span className="shrink-0">#{pr.number}</span>
      {pr.state !== "open" ? (
        <span className="shrink-0 uppercase opacity-70">{pr.state}</span>
      ) : null}
      {pr.title ? <span className="truncate opacity-80">{pr.title}</span> : null}
    </>
  );
  return pr.url ? (
    <a
      href={pr.url}
      target="_blank"
      rel="noreferrer"
      title={label}
      aria-label={`open ${label}`}
      className={cn(className, style.hover)}
    >
      {content}
    </a>
  ) : (
    <span title={label} aria-label={label} className={className}>
      {content}
    </span>
  );
};

export const DiffViewer = ({
  open,
  cwd,
  branchInfo,
  onClose,
  onSendToTerminal,
  onRefreshBranchInfo,
}: DiffViewerProps) => {
  const [mounted, setMounted] = useState(false);
  const [settled, setSettled] = useState(false);
  // Per-mode file lists, pre-fetched on cwd change (even while the viewer is
  // closed) so data is ready instantly on open. No cross-component ref — state
  // triggers re-renders, so the viewer always reflects the latest fetch.
  const [workingFiles, setWorkingFiles] = useState<GitDiffFileListResponse | null>(null);
  const [branchFiles, setBranchFiles] = useState<GitDiffFileListResponse | null>(null);
  const [hasError, setHasError] = useState(false);
  const [patchCache, setPatchCache] = useState<Record<string, PatchEntry>>({});
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<DiffViewMode>(() => loadStoredDiffViewMode());
  // Comparison mode is EPHEMERAL, not persisted: it defaults to working, and to
  // branch when the branch has a PR. `userPickedMode` (null = follow that
  // default) holds an explicit per-open toggle so the user can override; it's
  // reset on open and repo change.
  const [userPickedMode, setUserPickedMode] = useState<GitDiffMode | null>(null);
  // User-picked base ref for branch mode; null falls back to the server's
  // locally-resolved default branch. Reset per repo.
  const [baseOverride, setBaseOverride] = useState<string | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);

  const compareMode: GitDiffMode = userPickedMode ?? (branchInfo?.pr ? "branch" : "working");
  // Base ref shown in the picker. The DIFF fetch, however, only sends an explicit
  // base when the user overrode one — otherwise it sends none and the server
  // resolves a local default instantly, so the branch diff never waits on the
  // (slower, gh-backed) branch metadata.
  const displayBase =
    compareMode === "branch" ? (baseOverride ?? branchInfo?.defaultBase ?? null) : null;
  // Pending review annotations survive close/reopen until they are sent.
  const [annotations, setAnnotations] = useState<Record<string, DiffAnnotation>>({});
  const [editingKey, setEditingKey] = useState<string | null>(null);
  // Range selected by the drag that opened the current editor, applied to the
  // annotation on save.
  const [pendingRange, setPendingRange] = useState<PendingAnnotationRange | null>(null);
  const dragCancelRef = useRef<(() => void) | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const fileListRef = useRef<HTMLDivElement | null>(null);
  // In-flight per-file patch fetches, so they can be aborted on close/refresh.
  const patchControllersRef = useRef<Map<string, AbortController>>(new Map());
  // Tracks the last-seen file metadata per path+mode so the patch-loading
  // effect can detect real changes (additions/deletions/status) vs mere
  // reference identity changes from re-fetches returning identical data.
  // Includes compareMode+base so switching modes invalidates stale patches.
  const lastFileMetaRef = useRef<Map<string, string>>(new Map());
  // Latest cache, read by loadPatch without making it depend on patchCache.
  const patchCacheRef = useRef(patchCache);
  patchCacheRef.current = patchCache;

  useEffect(() => {
    if (open) {
      setMounted(true);
      // Each open re-derives the mode from PR presence (ephemeral) unless the
      // user toggles during this session.
      setUserPickedMode(null);
      const frame = requestAnimationFrame(() => setSettled(true));
      return () => cancelAnimationFrame(frame);
    }
    setSettled(false);
    if (mounted) {
      const timer = window.setTimeout(() => setMounted(false), DIFF_VIEWER_CLOSE_TRANSITION_MS);
      return () => window.clearTimeout(timer);
    }
  }, [open]);

  const abortPatchFetches = useCallback(() => {
    for (const controller of patchControllersRef.current.values()) controller.abort();
    patchControllersRef.current.clear();
  }, []);

  // Switching repos resets mode overrides, file-list state, and patches.
  useEffect(() => {
    setBaseOverride(null);
    setUserPickedMode(null);
    setWorkingFiles(null);
    setBranchFiles(null);
    setHasError(false);
    setPatchCache({});
    lastFileMetaRef.current.clear();
    abortPatchFetches();
  }, [cwd, abortPatchFetches]);

  // Pre-fetch both file lists on cwd change. Runs while the viewer is closed so
  // data is ready on open. Branch fetch is chained after working (sequential) to
  // keep peak concurrent git processes low (~2-3 at a time, not 6+).
  useEffect(() => {
    if (!cwd) return;
    const controller = new AbortController();
    void (async () => {
      const working = await fetchGitDiffFiles(cwd, { mode: "working" }, controller.signal);
      if (controller.signal.aborted || !working) return;
      setWorkingFiles(working);
      const branch = await fetchGitDiffFiles(cwd, { mode: "branch" }, controller.signal);
      if (controller.signal.aborted || !branch) return;
      setBranchFiles(branch);
    })();
    return () => controller.abort();
  }, [cwd]);

  const workingFilesRef = useRef(workingFiles);
  workingFilesRef.current = workingFiles;
  const branchFilesRef = useRef(branchFiles);
  branchFilesRef.current = branchFiles;

  // On-open revalidation: when the viewer opens with data already present, show
  // it immediately and silently refresh in the background. When data is missing
  // (first load on a fresh cwd, or explicit refresh), fetch with the center
  // spinner. Mode switches read from the per-mode state — no spinner.
  useEffect(() => {
    if (!open || !cwd) {
      abortPatchFetches();
      setPatchCache((prev) => {
        let changed = false;
        const next: Record<string, PatchEntry> = {};
        for (const [path, entry] of Object.entries(prev)) {
          if (entry.state === "loading") changed = true;
          else next[path] = entry;
        }
        return changed ? next : prev;
      });
      return;
    }
    const currentData = compareMode === "branch" ? branchFilesRef.current : workingFilesRef.current;
    const setter = compareMode === "branch" ? setBranchFiles : setWorkingFiles;
    const query = { mode: compareMode, base: baseOverride };

    if (currentData) {
      const controller = new AbortController();
      void (async () => {
        const response = await fetchGitDiffFiles(cwd, query, controller.signal);
        if (controller.signal.aborted || !response) return;
        setter(response);
      })();
      return () => controller.abort();
    }

    setHasError(false);
    abortPatchFetches();
    setPatchCache({});
    const controller = new AbortController();
    void (async () => {
      const response = await fetchGitDiffFiles(cwd, query, controller.signal);
      if (controller.signal.aborted) return;
      if (!response) {
        setHasError(true);
        return;
      }
      setter(response);
    })();
    return () => controller.abort();
  }, [open, cwd, refreshCount, compareMode, baseOverride, abortPatchFetches]);

  // Invalidate cached patches when the comparison mode or base changes —
  // patches from one mode are wrong for another.
  useEffect(() => {
    abortPatchFetches();
    setPatchCache({});
    lastFileMetaRef.current.clear();
  }, [compareMode, baseOverride, abortPatchFetches]);

  const displayFileList = compareMode === "branch" ? branchFiles : workingFiles;
  const files = useMemo(() => displayFileList?.files ?? [], [displayFileList]);

  const loadPatch = useCallback(
    (path: string | null | undefined, force = false) => {
      if (!path || !cwd) return;
      const existing = patchCacheRef.current[path];
      const inFlight = patchControllersRef.current.has(path);
      if (
        !force &&
        existing &&
        (existing.state === "loaded" || (existing.state === "loading" && inFlight))
      )
        return;
      if (force && existing?.state === "loading" && inFlight) return;
      const previousData = existing?.data;
      setPatchCache((previous) => ({
        ...previous,
        [path]: { state: "loading", ...(previousData ? { data: previousData } : {}) },
      }));
      patchControllersRef.current.get(path)?.abort();
      const controller = new AbortController();
      patchControllersRef.current.set(path, controller);
      void fetchGitDiffFilePatch(
        cwd,
        path,
        { mode: compareMode, base: baseOverride },
        controller.signal,
      )
        .then((data) => {
          if (controller.signal.aborted) return;
          patchControllersRef.current.delete(path);
          if (data?.patch) {
            const langId = detectLangId(path);
            if (langId) {
              const hunks = parseUnifiedDiff(data.patch);
              const allLines = hunks.flatMap((hunk) => hunk.lines);
              if (allLines.length > 0) {
                prefetchTokens(
                  path,
                  allLines.map((line) => line.text),
                  langId,
                );
              }
            }
          }
          setPatchCache((previous) => ({
            ...previous,
            [path]: data ? { state: "loaded", data } : { state: "error" },
          }));
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          patchControllersRef.current.delete(path);
          setPatchCache((previous) => ({
            ...previous,
            [path]: { state: "error" },
          }));
        });
    },
    [cwd, compareMode, baseOverride],
  );

  // Keep a valid selection: follow the current file across refreshes, fall back
  // to the first file when it disappears.
  useEffect(() => {
    if (!displayFileList) return;
    if (selectedPath && files.some((file) => file.path === selectedPath)) return;
    setSelectedPath(files[0]?.path ?? null);
  }, [displayFileList, files, selectedPath]);

  // Load the selected file's patch on demand, and prefetch its neighbors so j/k
  // navigation stays instant. When the selected file's metadata changes
  // (different additions/deletions/status), force a re-fetch so files updated
  // on disk never show a stale diff.
  useEffect(() => {
    if (!selectedPath) return;
    const selectedMeta = files.find((file) => file.path === selectedPath);
    const modeKey = `${compareMode}:${baseOverride ?? ""}`;
    const metaKey = selectedMeta
      ? `${modeKey}:${selectedMeta.additions}:${selectedMeta.deletions}:${selectedMeta.status}:${selectedMeta.binary}`
      : modeKey;
    const lastKey = lastFileMetaRef.current.get(selectedPath);
    const fileChanged = lastKey !== undefined && lastKey !== metaKey;
    lastFileMetaRef.current.set(selectedPath, metaKey);
    loadPatch(selectedPath, fileChanged);
    const index = files.findIndex((file) => file.path === selectedPath);
    if (index >= 0) {
      loadPatch(files[index - 1]?.path);
      loadPatch(files[index + 1]?.path);
    }
  }, [selectedPath, displayFileList, files, loadPatch]);

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
      // The annotation editor's textarea handles Escape itself (closes just the
      // editor) and owns all typing.
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
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" || target.tagName === "SELECT")
      ) {
        return;
      }
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

  // An explicit toggle overrides the PR-derived default for the rest of this open
  // (cleared on close/reopen — the mode is intentionally not persisted).
  const handleCompareModeChange = useCallback((nextMode: GitDiffMode) => {
    setUserPickedMode(nextMode);
  }, []);

  // Refresh both the diff and the leased branch/PR metadata.
  const handleRefresh = useCallback(() => {
    if (compareMode === "branch") setBranchFiles(null);
    else setWorkingFiles(null);
    setHasError(false);
    setRefreshCount((count) => count + 1);
    onRefreshBranchInfo?.();
  }, [compareMode, onRefreshBranchInfo]);

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

  // Options for the base picker: the candidate refs, plus the active base if it
  // somehow isn't among them (e.g. a detached default), so the select can show it.
  const baseOptions = useMemo(() => {
    const refs = branchInfo?.branches ?? [];
    if (displayBase && !refs.includes(displayBase)) return [displayBase, ...refs];
    return refs;
  }, [branchInfo, displayBase]);

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
  const isRepo = (displayFileList?.isRepo ?? true) && (branchInfo?.isRepo ?? true);
  const isEmpty = displayFileList !== null && isRepo && files.length === 0;
  const isBranchMode = compareMode === "branch";
  const pr = branchInfo?.pr ?? null;
  // Branch metadata is leased but no plausible base branch exists (e.g. a
  // single-branch repo).
  const branchNoBase = isBranchMode && branchInfo !== null && displayBase === null;

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
          <h2 className="shrink-0 text-sm font-medium text-foreground">Changes</h2>
          <div
            role="radiogroup"
            aria-label="diff comparison"
            className="flex shrink-0 items-center rounded-md border border-border/60 p-0.5"
          >
            {(
              [
                ["working", "Working"],
                ["branch", "Branch"],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={compareMode === mode}
                onClick={() => handleCompareModeChange(mode)}
                className={cn(
                  "rounded-sm px-2 py-0.5 text-xs transition-colors",
                  compareMode === mode
                    ? "bg-foreground/10 text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {isBranchMode ? (
            <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              <GitBranch className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="shrink-0">vs</span>
              <select
                aria-label="base branch"
                value={displayBase ?? ""}
                disabled={branchInfo === null}
                onChange={(event) => setBaseOverride(event.target.value || null)}
                className="max-w-48 truncate rounded-md border border-border/60 bg-background px-1.5 py-0.5 font-mono text-xs text-foreground outline-none focus-visible:border-ring disabled:opacity-50 [&>option]:bg-popover [&>option]:text-foreground"
              >
                {branchInfo === null ? (
                  <option value="">Loading…</option>
                ) : baseOptions.length === 0 ? (
                  <option value="">No branches</option>
                ) : (
                  baseOptions.map((ref) => (
                    <option key={ref} value={ref}>
                      {ref}
                    </option>
                  ))
                )}
              </select>
            </div>
          ) : null}
          {/* PR badge shows in both modes so even the working-tree diff signals
              "this branch has a PR" (with its open/merged/closed status). */}
          {pr ? <PrBadge pr={pr} /> : null}
          <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
            <span className={ADDITIONS_CLASSES}>+{totals.additions.toLocaleString()}</span>{" "}
            <span className={DELETIONS_CLASSES}>−{totals.deletions.toLocaleString()}</span>
            {totals.binaries > 0 ? (
              <span className="text-muted-foreground/70"> · {totals.binaries} binary</span>
            ) : null}
          </span>
          {displayFileList === null ? (
            <Spinner className="size-3.5" aria-label="loading diff" />
          ) : null}
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
              onClick={handleRefresh}
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
            <Button variant="outline" size="xs" onClick={handleRefresh}>
              Retry
            </Button>
          </div>
        ) : !isRepo ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Not a git repository.
          </div>
        ) : branchNoBase ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
            Couldn't find a base branch to compare against. Pick one once more branches exist.
          </div>
        ) : isEmpty ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
            {isBranchMode
              ? `No changes between ${displayBase ?? "the base branch"} and your working tree.`
              : "Working tree clean — nothing to diff."}
          </div>
        ) : displayFileList === null ? (
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
                      key={selectedFile.path}
                      file={selectedFile}
                      payload={patchCache[selectedFile.path] ?? { state: "loading" }}
                      viewMode={viewMode}
                      annotations={annotations}
                      editingKey={editingKey}
                      pendingRange={pendingRange}
                      dragCancelRef={dragCancelRef}
                      onOpenEditor={openAnnotationEditor}
                      onSaveAnnotation={saveAnnotation}
                      onCancelEditor={cancelAnnotationEditor}
                      onDeleteAnnotation={deleteAnnotation}
                      onRetry={() => loadPatch(selectedFile.path)}
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
