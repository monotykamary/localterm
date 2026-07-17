import { MessageSquare, MessageSquarePlus, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { DiffLineTarget } from "@/utils/diff-line-ranges";
import type { DiffAnnotation } from "@/utils/format-review-prompt";

export const formatRangeLabel = (start: DiffLineTarget, end: DiffLineTarget): string => {
  const sideRef = (target: DiffLineTarget) =>
    `${target.side === "old" ? "old " : ""}L${target.lineNumber}`;
  return start.side === end.side
    ? `${start.side === "old" ? "old " : ""}L${start.lineNumber}–L${end.lineNumber}`
    : `${sideRef(start)} – ${sideRef(end)}`;
};

// Overlays a line covered by a multiline annotation or an in-progress drag
// selection. pointer-events-none keeps the line interactive beneath it.
export const RangeHighlight = () => (
  <span
    aria-hidden="true"
    className="pointer-events-none absolute inset-0 z-20 border-l-2 border-primary/60 bg-primary/10"
  />
);

interface AnnotateLineButtonProps {
  onClick: () => void;
  onDragStart: () => void;
}

export const AnnotateLineButton = ({ onClick, onDragStart }: AnnotateLineButtonProps) => (
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
export const AnnotationBlock = ({
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
