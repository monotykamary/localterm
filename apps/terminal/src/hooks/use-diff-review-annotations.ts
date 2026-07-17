import { useCallback, useMemo, useRef, useState } from "react";
import type { PendingAnnotationRange } from "@/components/diff-viewer-types";
import {
  diffAnnotationKey,
  formatReviewPrompt,
  type DiffAnnotation,
} from "@/utils/format-review-prompt";

interface UseDiffReviewAnnotationsOptions {
  onClose: () => void;
  onSendToTerminal: ((text: string) => void) | undefined;
}

export const useDiffReviewAnnotations = ({
  onClose,
  onSendToTerminal,
}: UseDiffReviewAnnotationsOptions) => {
  // Pending review annotations survive close/reopen until they are sent.
  const [annotations, setAnnotations] = useState<Record<string, DiffAnnotation>>({});
  const [editingKey, setEditingKey] = useState<string | null>(null);
  // Range selected by the drag that opened the current editor, applied to the
  // annotation on save.
  const [pendingRange, setPendingRange] = useState<PendingAnnotationRange | null>(null);
  const dragCancelRef = useRef<(() => void) | null>(null);

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

  return {
    annotationCounts,
    annotationList,
    annotations,
    cancelAnnotationEditor,
    clearAnnotations,
    deleteAnnotation,
    dragCancelRef,
    editingKey,
    handleSendToTerminal,
    openAnnotationEditor,
    pendingRange,
    saveAnnotation,
  };
};
