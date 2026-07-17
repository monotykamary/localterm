import type { GitDiffFileMeta } from "@monotykamary/localterm-server/protocol";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { VirtualItem } from "@tanstack/react-virtual";
import { MessageSquare, Search } from "lucide-react";
import {
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import {
  DIFF_ADDITIONS_CLASSES,
  DIFF_DELETIONS_CLASSES,
  DIFF_FILE_STATUS_LABELS,
} from "@/components/diff-viewer-file-status";
import type { FileListVirtualizerHandle } from "@/components/diff-viewer-types";
import {
  DIFF_VIEWER_FILE_LIST_OVERSCAN_ROWS,
  DIFF_VIEWER_FILE_ROW_HEIGHT_PX,
} from "@/lib/constants";
import { cn } from "@/lib/utils";
import { splitFilePath } from "@/utils/split-file-path";

interface DiffFileOptionProps {
  file: GitDiffFileMeta;
  isSelected: boolean;
  commentCount?: number;
  compact?: boolean;
  style?: CSSProperties;
  dataIndex?: number;
  onSelect: (path: string) => void;
}

const DiffFileOption = ({
  file,
  isSelected,
  commentCount = 0,
  compact = false,
  style,
  dataIndex,
  onSelect,
}: DiffFileOptionProps) => {
  const status = DIFF_FILE_STATUS_LABELS[file.status];
  const { directory, basename } = splitFilePath(file.path);

  return (
    <button
      type="button"
      role="option"
      aria-selected={isSelected}
      onClick={() => onSelect(file.path)}
      data-index={dataIndex}
      className={cn(
        "flex w-full items-center gap-2 rounded-sm px-2 text-left text-xs outline-none transition-colors",
        compact ? "py-1" : "py-1.5",
        isSelected
          ? "bg-foreground/10 text-foreground"
          : "text-muted-foreground hover:bg-foreground/5",
      )}
      style={style}
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
          <span className={DIFF_ADDITIONS_CLASSES}>+{file.additions}</span>{" "}
          <span className={DIFF_DELETIONS_CLASSES}>−{file.deletions}</span>
        </span>
      )}
    </button>
  );
};

interface FileListPopoverProps {
  files: GitDiffFileMeta[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

export const FileListPopover = ({ files, selectedPath, onSelect }: FileListPopoverProps) => {
  const [search, setSearch] = useState("");
  const filteredFiles = useMemo(() => {
    const normalizedSearch = search.toLowerCase();
    return normalizedSearch
      ? files.filter((file) => file.path.toLowerCase().includes(normalizedSearch))
      : files;
  }, [files, search]);

  return (
    <div className="flex max-h-72 flex-col" data-slot="file-list-popover">
      <div className="border-b border-border/40 px-2 py-1.5">
        <input
          type="text"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search files…"
          autoFocus
          className="w-full rounded-sm border border-border/50 bg-transparent py-0.5 px-1.5 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-ring"
        />
      </div>
      <div
        className="overflow-y-auto overscroll-contain p-1"
        role="listbox"
        aria-label="changed files"
      >
        {filteredFiles.length === 0 ? (
          <p className="px-2 py-3 text-center text-xs text-muted-foreground">
            {files.length === 0 ? "No files changed." : "No files match your search."}
          </p>
        ) : (
          filteredFiles.map((file) => (
            <DiffFileOption
              key={file.path}
              file={file}
              isSelected={file.path === selectedPath}
              compact
              onSelect={onSelect}
            />
          ))
        )}
      </div>
    </div>
  );
};

interface FileListSidebarProps {
  files: GitDiffFileMeta[];
  selectedPath: string | null;
  annotationCounts: Map<string, number>;
  onSelect: (path: string) => void;
  virtualizerRef: RefObject<FileListVirtualizerHandle | null>;
}

export const FileListSidebar = ({
  files,
  selectedPath,
  annotationCounts,
  onSelect,
  virtualizerRef,
}: FileListSidebarProps) => {
  const [search, setSearch] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const filteredFiles = useMemo(() => {
    const normalizedSearch = search.toLowerCase();
    return normalizedSearch
      ? files.filter((file) => file.path.toLowerCase().includes(normalizedSearch))
      : files;
  }, [files, search]);
  const virtualizer = useVirtualizer({
    count: filteredFiles.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => DIFF_VIEWER_FILE_ROW_HEIGHT_PX,
    overscan: DIFF_VIEWER_FILE_LIST_OVERSCAN_ROWS,
    getItemKey: (index) => filteredFiles[index].path,
  });

  useImperativeHandle(virtualizerRef, () => ({ scrollToIndex: virtualizer.scrollToIndex }), [
    virtualizer,
  ]);

  return (
    <div className="flex h-full flex-col">
      <div className="relative px-1.5 pt-1.5 pb-0.5">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 size-3 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          type="text"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search files…"
          className="w-full rounded-sm border border-border/50 bg-transparent py-1 pl-6 pr-2 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-border"
        />
      </div>
      <div
        ref={scrollRef}
        role="listbox"
        aria-label="changed files"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5 pt-0"
      >
        {files.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">No files changed.</p>
        ) : filteredFiles.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">
            No files match your search.
          </p>
        ) : (
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow: VirtualItem) => {
              const file = filteredFiles[virtualRow.index];
              const virtualRowStyle = {
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              } satisfies CSSProperties;
              return (
                <DiffFileOption
                  key={file.path}
                  file={file}
                  isSelected={file.path === selectedPath}
                  commentCount={annotationCounts.get(file.path) ?? 0}
                  dataIndex={virtualRow.index}
                  style={virtualRowStyle}
                  onSelect={onSelect}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
