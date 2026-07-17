import { Fragment, memo } from "react";
import {
  AnnotationBlock,
  AnnotateLineButton,
  formatRangeLabel,
  RangeHighlight,
} from "@/components/diff-viewer-annotation-ui";
import {
  DIFF_ADDITIONS_CLASSES,
  DIFF_DELETIONS_CLASSES,
} from "@/components/diff-viewer-file-status";
import type { PendingAnnotationRange } from "@/components/diff-viewer-types";
import { cn } from "@/lib/utils";
import type { SplitDiffRow } from "@/utils/build-split-diff-rows";
import type { RenderChunk } from "@/utils/build-render-chunks";
import {
  annotationRangeStart,
  diffAnnotationKey,
  type DiffAnnotation,
} from "@/utils/format-review-prompt";
import {
  diffLineTargetFor,
  diffLineTargetKey,
  type DiffLineTarget,
} from "@/utils/diff-line-ranges";
import type { DiffLine } from "@/utils/parse-unified-diff";
import { renderSyntaxTokens } from "@/utils/render-syntax-tokens";
import type { SyntaxLine } from "@/utils/syntax-highlight";

const LINE_NUMBER_CELL_CLASSES =
  "w-12 shrink-0 select-none px-2 text-right text-muted-foreground/50 tabular-nums";

const lineBackgroundClasses = (type: DiffLine["type"]): string => {
  if (type === "add") return "bg-emerald-500/10";
  if (type === "del") return "bg-red-500/10";
  return "";
};

const lineTextClasses = (type: DiffLine["type"]): string =>
  type === "context" ? "text-muted-foreground" : "text-foreground/90";

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
  const effectiveType = line.type === "context" ? "context" : side === "left" ? "del" : "add";
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

interface LineAnnotationState {
  key: string;
  target: DiffLineTarget;
  saved: DiffAnnotation | undefined;
  isEditing: boolean;
  rangeStart: DiffLineTarget | null;
  save: (comment: string) => void;
}

// One rendered slice of the diff. Memoized: during the progressive grow every
// prop is referentially stable for already-mounted chunks, so only the newly
// revealed chunk renders (keeps growth O(chunk), not O(total)).
export const DiffChunk = memo((props: DiffChunkProps) => {
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
