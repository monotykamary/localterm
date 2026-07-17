import type { GitDiffFileMeta } from "@monotykamary/localterm-server/protocol";
import { isImagePath } from "@monotykamary/localterm-server/protocol";
import { FileWarning, MessageSquare, MessageSquarePlus, Pencil, Trash2 } from "lucide-react";
import {
  Fragment,
  memo,
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import {
  DIFF_ADDITIONS_CLASSES,
  DIFF_DELETIONS_CLASSES,
} from "@/components/diff-viewer-file-status";
import type { PendingAnnotationRange, PatchEntry } from "@/components/diff-viewer-types";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  DIFF_VIEWER_INITIAL_LINE_LIMIT,
  DIFF_VIEWER_RENDER_CHUNK,
  DIFF_VIEWER_SPLIT_WHEEL_LINE_PX,
  DIFF_VIEWER_SPLIT_WHEEL_PAGE_PX,
} from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { SplitDiffRow } from "@/utils/build-split-diff-rows";
import {
  buildRenderChunks,
  renderChunkLength,
  type RenderChunk,
} from "@/utils/build-render-chunks";
import { buildFileUrl } from "@/utils/build-file-url";
import {
  buildDiffLineRangeIndex,
  coveredTargetKeys,
  diffLineTargetFor,
  diffLineTargetKey,
  resolveDragRange,
  type DiffLineRange,
  type DiffLineTarget,
} from "@/utils/diff-line-ranges";
import {
  annotationRangeStart,
  diffAnnotationKey,
  type DiffAnnotation,
} from "@/utils/format-review-prompt";
import { parseUnifiedDiff, type DiffLine } from "@/utils/parse-unified-diff";
import { renderSyntaxTokens } from "@/utils/render-syntax-tokens";
import { detectLangId, getCachedTokens, tokenizeDiffLines } from "@/utils/syntax-highlight";
import type { SyntaxHighlightColorScheme, SyntaxLine } from "@/utils/syntax-highlight";
import type { DiffViewMode } from "@/utils/stored-diff-view-mode";

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
    className="pointer-events-none absolute inset-0 z-20 border-l-2 border-primary/60 bg-primary/10"
  />
);

const LINE_NUMBER_CELL_CLASSES =
  "w-12 shrink-0 select-none px-2 text-right text-muted-foreground/50 tabular-nums";

const lineBackgroundClasses = (type: DiffLine["type"]): string => {
  if (type === "add") return "bg-emerald-500/10";
  if (type === "del") return "bg-red-500/10";
  return "";
};

const lineTextClasses = (type: DiffLine["type"]): string =>
  type === "context" ? "text-muted-foreground" : "text-foreground/90";

interface AnnotateLineButtonProps {
  onClick: () => void;
  onDragStart: () => void;
}

const AnnotateLineButton = ({ onClick, onDragStart }: AnnotateLineButtonProps) => (
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
    className="absolute top-1/2 left-1 z-20 hidden size-4 -translate-y-1/2 items-center justify-center rounded-sm bg-primary text-primary-foreground transition-transform group-hover/line:flex hover:scale-110"
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

const GUTTER_BG_OVERRIDES: Record<string, string> = {
  add: "linear-gradient(rgb(16 185 129 / 0.1), rgb(16 185 129 / 0.1))",
  del: "linear-gradient(rgb(239 68 68 / 0.1), rgb(239 68 68 / 0.1))",
};

interface UnifiedDiffLineProps extends LineCallbacks {
  line: DiffLine;
  annotateKey: string | null;
  highlighted: boolean;
  syntaxTokens: SyntaxLine | null;
  highlightingPending: boolean;
}

const UnifiedDiffLine = memo(
  ({
    line,
    annotateKey,
    highlighted,
    syntaxTokens,
    highlightingPending,
    onAnnotate,
    onStartDrag,
    onDragEnter,
  }: UnifiedDiffLineProps) => (
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
      <div
        className="sticky left-0 z-10 flex shrink-0 bg-background"
        style={
          GUTTER_BG_OVERRIDES[line.type]
            ? {
                backgroundImage: GUTTER_BG_OVERRIDES[line.type],
              }
            : undefined
        }
      >
        <span className={LINE_NUMBER_CELL_CLASSES}>{line.oldLine ?? ""}</span>
        <span className={LINE_NUMBER_CELL_CLASSES}>{line.newLine ?? ""}</span>
        <span
          className={cn(
            "w-5 shrink-0 select-none text-center",
            line.type === "add" && DIFF_ADDITIONS_CLASSES,
            line.type === "del" && DIFF_DELETIONS_CLASSES,
          )}
        >
          {line.type === "add" ? "+" : line.type === "del" ? "-" : ""}
        </span>
      </div>
      <span className="shrink-0 whitespace-pre pr-4">
        <span
          className={cn(
            highlightingPending && !syntaxTokens
              ? "invisible"
              : !syntaxTokens && lineTextClasses(line.type),
          )}
        >
          {syntaxTokens ? renderSyntaxTokens(syntaxTokens.tokens) : line.text}
          {line.noNewline ? (
            <span
              className="select-none text-muted-foreground/50"
              title="No newline at end of file"
            >
              {" ⊘"}
            </span>
          ) : null}
        </span>
      </span>
      {highlighted ? <RangeHighlight /> : null}
    </div>
  ),
);
UnifiedDiffLine.displayName = "UnifiedDiffLine";

interface SplitDiffCellProps {
  line: DiffLine | null;
  side: "left" | "right";
  syntaxTokens: SyntaxLine | null;
  highlightingPending: boolean;
  onAnnotate?: () => void;
  onDragStart?: () => void;
}

const SplitDiffCell = ({
  line,
  side,
  syntaxTokens,
  highlightingPending,
  onAnnotate,
  onDragStart,
}: SplitDiffCellProps) => {
  if (!line) {
    return (
      <>
        <span className={LINE_NUMBER_CELL_CLASSES} />
        <span className="min-w-0 flex-1 bg-muted/20" />
      </>
    );
  }
  const effectiveType =
    line.type === "context" ? "context" : side === "left" ? "del" : "add";
  return (
    <>
      {onAnnotate && onDragStart ? (
        <AnnotateLineButton onClick={onAnnotate} onDragStart={onDragStart} />
      ) : null}
      <span className={cn(LINE_NUMBER_CELL_CLASSES, lineBackgroundClasses(effectiveType))}>
        {side === "left" ? (line.oldLine ?? "") : (line.newLine ?? "")}
      </span>
      <span className={cn("min-w-0 flex-1 overflow-hidden", lineBackgroundClasses(effectiveType))}>
        <span
          data-split-text=""
          className={cn(
            "inline-block whitespace-pre pr-2",
            highlightingPending && !syntaxTokens
              ? "invisible"
              : !syntaxTokens && lineTextClasses(line.type),
          )}
        >
          {syntaxTokens ? renderSyntaxTokens(syntaxTokens.tokens) : line.text}
        </span>
      </span>
    </>
  );
};

interface SplitDiffRowViewProps extends LineCallbacks {
  row: SplitDiffRow;
  leftKey: string | null;
  leftHighlighted: boolean;
  rightKey: string | null;
  rightHighlighted: boolean;
  tokenMap: Map<DiffLine, SyntaxLine>;
  highlightingPending: boolean;
}

const SplitDiffRowView = memo(
  ({
    row,
    leftKey,
    leftHighlighted,
    rightKey,
    rightHighlighted,
    tokenMap,
    highlightingPending,
    onAnnotate,
    onStartDrag,
    onDragEnter,
  }: SplitDiffRowViewProps) => {
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
            highlightingPending={highlightingPending}
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
            highlightingPending={highlightingPending}
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

interface HunkHeaderProps {
  header: string;
}

const HunkHeader = ({ header }: HunkHeaderProps) => (
  <div className="sticky left-0 select-none bg-muted/30 px-4 py-0.5 text-muted-foreground/60">
    {header}
  </div>
);

interface DiffChunkProps {
  chunk: RenderChunk;
  filePath: string;
  tokenMap: Map<DiffLine, SyntaxLine>;
  highlightedKeys: ReadonlySet<string>;
  annotations: Record<string, DiffAnnotation>;
  editingKey: string | null;
  pendingRange: PendingAnnotationRange | null;
  highlightingPending: boolean;
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
    highlightingPending,
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
                  highlightingPending={highlightingPending}
                  onAnnotate={onOpenEditor}
                  onStartDrag={onStartDrag}
                  onDragEnter={onDragEnter}
                />
                {renderAnnotation(state)}
              </Fragment>
            );
          })
        : chunk.rows.map((row, rowIndex) => {
            const left = row.left;
            const right = row.right;

            const leftState = left ? annotationStateFor(left) : null;
            const rightState = right ? annotationStateFor(right) : null;
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
                  highlightingPending={highlightingPending}
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
  const [renderLimit, setRenderLimit] = useState(DIFF_VIEWER_INITIAL_LINE_LIMIT);
  const [drag, setDrag] = useState<DragSelection | null>(null);
  const scrollXRef = useRef(0);
  const maxScrollXRef = useRef(0);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const hunks = useMemo(() => (patch ? parseUnifiedDiff(patch) : []), [patch]);
  const rangeIndex = useMemo(() => buildDiffLineRangeIndex(hunks), [hunks]);

  const [syntaxResult, setSyntaxResult] = useState<readonly SyntaxLine[] | null | undefined>(() => {
    if (!patch) return undefined;
    const initialHunks = parseUnifiedDiff(patch);
    const langId = detectLangId(file.path);
    if (!langId || initialHunks.length === 0) return null;
    const allLines = initialHunks.flatMap((hunk) => hunk.lines);
    const texts = allLines.map((line) => line.text);
    return getCachedTokens(file.path, texts, syntaxHighlightColorScheme);
  });

  const highlightingPending = syntaxResult === undefined;

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
    const cached = getCachedTokens(file.path, texts, syntaxHighlightColorScheme);
    if (cached !== undefined) {
      setSyntaxResult(cached);
      return;
    }
    setSyntaxResult(undefined);
    let cancelled = false;
    tokenizeDiffLines(file.path, texts, langId, syntaxHighlightColorScheme).then((result) => {
      if (cancelled) return;
      startTransition(() => setSyntaxResult(result));
    });
    return () => {
      cancelled = true;
    };
  }, [file.path, hunks, syntaxHighlightColorScheme]);

  useEffect(() => {
    if (viewMode !== "split") return;
    scrollXRef.current = 0;
    scrollContainerRef.current?.style.setProperty("--diff-scroll-x", "0px");
  }, [viewMode]);

  const measureMaxScrollX = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    requestAnimationFrame(() => {
      const currentContainer = scrollContainerRef.current;
      if (!currentContainer) return;
      const textElements = currentContainer.querySelectorAll<HTMLElement>("[data-split-text]");
      let maxOverflow = 0;
      textElements.forEach((element) => {
        const inner = element;
        const outer = inner.parentElement;
        if (!outer) return;
        maxOverflow = Math.max(maxOverflow, inner.scrollWidth - outer.clientWidth);
      });
      maxScrollXRef.current = maxOverflow;
      if (maxOverflow > 0 && scrollXRef.current > maxOverflow) {
        scrollXRef.current = maxOverflow;
        currentContainer.style.setProperty("--diff-scroll-x", `${maxOverflow}px`);
      }
    });
  }, []);

  useLayoutEffect(() => {
    if (viewMode !== "split") {
      maxScrollXRef.current = 0;
      return;
    }
    measureMaxScrollX();
    const observer = new MutationObserver(measureMaxScrollX);
    if (scrollContainerRef.current) {
      observer.observe(scrollContainerRef.current, { childList: true, subtree: true });
    }
    return () => observer.disconnect();
  }, [viewMode, measureMaxScrollX]);

  useEffect(() => {
    if (viewMode !== "split") return;
    const container = scrollContainerRef.current;
    if (!container) return;
    const handleSplitWheel = (event: WheelEvent) => {
      const hasHorizontal = event.deltaX !== 0;
      const isShiftVertical = event.shiftKey && event.deltaY !== 0 && event.deltaX === 0;
      if (!hasHorizontal && !isShiftVertical) return;
      if (event.deltaY === 0 || isShiftVertical) {
        event.preventDefault();
      }
      const rawDelta = hasHorizontal ? event.deltaX : event.deltaY;
      const delta =
        event.deltaMode === 1
          ? rawDelta * DIFF_VIEWER_SPLIT_WHEEL_LINE_PX
          : event.deltaMode === 2
            ? rawDelta * DIFF_VIEWER_SPLIT_WHEEL_PAGE_PX
            : rawDelta;
      scrollXRef.current = Math.max(0, Math.min(scrollXRef.current + delta, maxScrollXRef.current));
      container.style.setProperty("--diff-scroll-x", `${scrollXRef.current}px`);
    };
    container.addEventListener("wheel", handleSplitWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleSplitWheel);
  }, [viewMode]);

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

  const hiddenRows = totalRenderRows - renderedRows;

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
