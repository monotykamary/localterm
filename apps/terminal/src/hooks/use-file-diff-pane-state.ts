import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { RefObject } from "react";
import type { PendingAnnotationRange } from "@/components/diff-viewer-types";
import {
  DIFF_VIEWER_INITIAL_LINE_LIMIT,
  DIFF_VIEWER_RENDER_CHUNK,
  DIFF_VIEWER_SPLIT_WHEEL_LINE_PX,
  DIFF_VIEWER_SPLIT_WHEEL_PAGE_PX,
} from "@/lib/constants";
import { buildRenderChunkWindow } from "@/utils/build-render-chunk-window";
import { buildRenderChunks } from "@/utils/build-render-chunks";
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
import { useLatestRef } from "@/utils/use-latest-ref";
import {
  detectLangId,
  getCachedTokens,
  tokenizeDiffLines,
  type SyntaxHighlightColorScheme,
  type SyntaxLine,
} from "@/utils/syntax-highlight";
import type { DiffViewMode } from "@/utils/stored-diff-view-mode";

interface DragSelection {
  anchor: DiffLineTarget;
  focus: DiffLineTarget;
}

interface UseFileDiffPaneStateOptions {
  filePath: string;
  patch: string | null;
  syntaxHighlightColorScheme: SyntaxHighlightColorScheme;
  viewMode: DiffViewMode;
  annotations: Record<string, DiffAnnotation>;
  pendingRange: PendingAnnotationRange | null;
  dragCancelRef: RefObject<(() => void) | null>;
  onOpenEditor: (key: string, range?: PendingAnnotationRange) => void;
}

export const useFileDiffPaneState = ({
  filePath,
  patch,
  syntaxHighlightColorScheme,
  viewMode,
  annotations,
  pendingRange,
  dragCancelRef,
  onOpenEditor,
}: UseFileDiffPaneStateOptions) => {
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
    const langId = detectLangId(filePath);
    if (!langId || initialHunks.length === 0) return null;
    const allLines = initialHunks.flatMap((hunk) => hunk.lines);
    const texts = allLines.map((line) => line.text);
    return getCachedTokens(filePath, texts, syntaxHighlightColorScheme);
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
    const langId = detectLangId(filePath);
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
    const cached = getCachedTokens(filePath, texts, syntaxHighlightColorScheme);
    if (cached !== undefined) {
      setSyntaxResult(cached);
      return;
    }
    setSyntaxResult(undefined);
    let cancelled = false;
    tokenizeDiffLines(filePath, texts, langId, syntaxHighlightColorScheme).then((result) => {
      if (cancelled) return;
      startTransition(() => setSyntaxResult(result));
    });
    return () => {
      cancelled = true;
    };
  }, [filePath, hunks, syntaxHighlightColorScheme]);

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
  const {
    visibleChunks,
    totalRows: totalRenderRows,
    hiddenRows,
  } = useMemo(() => buildRenderChunkWindow(renderChunks, renderLimit), [renderChunks, renderLimit]);

  const isDragging = drag !== null;
  const isDraggingRef = useLatestRef(isDragging);
  const dragRange = drag ? resolveDragRange(rangeIndex, drag.anchor, drag.focus) : null;
  const dragRangeRef = useLatestRef(dragRange);

  // Stable across renders so memoized rows bail out during the grow; identity is
  // gated on a ref instead of `isDragging` so starting a drag doesn't churn props.
  const handleStartDrag = useCallback((line: DiffLine) => {
    const target = diffLineTargetFor(line);
    if (target) setDrag({ anchor: target, focus: target });
  }, []);
  const handleDragEnter = useCallback(
    (line: DiffLine) => {
      if (!isDraggingRef.current) return;
      const target = diffLineTargetFor(line);
      if (target) setDrag((previous) => (previous ? { ...previous, focus: target } : previous));
    },
    [isDraggingRef],
  );

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
      const key = diffAnnotationKey({ filePath, ...range.end });
      const isMultiline = diffLineTargetKey(range.start) !== diffLineTargetKey(range.end);
      onOpenEditor(key, isMultiline ? { filePath, ...range } : undefined);
    };
    window.addEventListener("pointerup", commitDrag);
    window.addEventListener("pointercancel", cancelDrag);
    return () => {
      dragCancelRef.current = null;
      window.removeEventListener("pointerup", commitDrag);
      window.removeEventListener("pointercancel", cancelDrag);
    };
  }, [isDragging, filePath, onOpenEditor, dragCancelRef, dragRangeRef]);

  // Lines covered by the live drag, the just-committed editor range, or any saved
  // multiline annotation in this file.
  const highlightedKeys = useMemo(() => {
    const keys = new Set<string>();
    const addRange = (range: DiffLineRange | null) => {
      if (!range) return;
      for (const key of coveredTargetKeys(rangeIndex, range)) keys.add(key);
    };
    addRange(dragRange);
    if (pendingRange && pendingRange.filePath === filePath) addRange(pendingRange);
    for (const annotation of Object.values(annotations)) {
      if (annotation.filePath !== filePath) continue;
      const start = annotationRangeStart(annotation);
      if (start) {
        addRange({ start, end: { side: annotation.side, lineNumber: annotation.lineNumber } });
      }
    }
    return keys;
  }, [rangeIndex, dragRange, pendingRange, annotations, filePath]);

  return {
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
  };
};
