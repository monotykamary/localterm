import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TAB_MIN_WIDTH_PX } from "@/lib/constants";
import { useSessions } from "@/lib/use-sessions";
import { cn } from "@/lib/utils";

interface TabBarProps {
  onNew: () => void;
}

const TAB_TRIGGER_CLASSES = cn(
  "h-full min-w-0 flex-1 justify-start rounded-none border-0 bg-transparent px-3 text-xs font-normal whitespace-nowrap text-muted-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
  "data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none",
);

export const TabBar = ({ onNew }: TabBarProps) => {
  const sessions = useSessions((state) => state.sessions);
  const activeId = useSessions((state) => state.activeId);
  const remove = useSessions((state) => state.remove);

  const canClose = sessions.length > 1;

  return (
    <TabsList
      variant="line"
      className="flex h-9 w-full shrink-0 items-stretch gap-0 rounded-none bg-[#0a0a0a] p-0"
    >
      {sessions.map((session, index) => {
        const isActive = session.id === activeId;
        const isPrevActive = sessions[index - 1]?.id === activeId;
        const label = session.title || "shell";
        return (
          <ContextMenu key={session.id}>
            <Tooltip>
              <ContextMenuTrigger asChild>
                <TooltipTrigger asChild>
                  <div
                    className={cn(
                      "group/tab relative flex min-w-0 flex-1 items-center transition-colors",
                      isActive
                        ? "bg-[#101010]"
                        : "border-b border-white/[0.06] hover:bg-white/[0.02]",
                      session.exited && "italic opacity-60",
                    )}
                    style={{ minWidth: TAB_MIN_WIDTH_PX }}
                    onAuxClick={(event) => {
                      if (event.button === 1 && canClose) {
                        event.preventDefault();
                        void remove(session.id);
                      }
                    }}
                  >
                    {!isActive && index > 0 && !isPrevActive ? (
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-y-2 left-0 w-px bg-white/[0.06]"
                      />
                    ) : null}
                    <TabsTrigger value={session.id} className={TAB_TRIGGER_CLASSES}>
                      <span className="truncate">{label}</span>
                    </TabsTrigger>
                    {canClose ? (
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`close ${label}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          void remove(session.id);
                        }}
                        className={cn(
                          "mr-1 size-5 rounded transition-opacity hover:bg-white/10",
                          isActive
                            ? "opacity-40 hover:opacity-100"
                            : "opacity-0 group-hover/tab:opacity-100",
                        )}
                      >
                        <X aria-hidden="true" />
                      </Button>
                    ) : null}
                  </div>
                </TooltipTrigger>
              </ContextMenuTrigger>
              <TooltipContent side="bottom" className="font-mono text-xs">
                <div>{session.cwd}</div>
                <div className="text-muted-foreground">{session.shell}</div>
              </TooltipContent>
            </Tooltip>
            <ContextMenuContent className="font-mono text-xs">
              <ContextMenuItem disabled={!canClose} onSelect={() => void remove(session.id)}>
                close tab
                <ContextMenuShortcut>⌥⌘W</ContextMenuShortcut>
              </ContextMenuItem>
              <ContextMenuItem onSelect={onNew}>
                new tab
                <ContextMenuShortcut>⌥⌘T</ContextMenuShortcut>
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem disabled className="text-muted-foreground">
                <span className="truncate">{session.cwd}</span>
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        );
      })}
      <div
        className={cn(
          "flex shrink-0 items-center px-1",
          sessions.length === 0 ? null : "border-b border-white/[0.06]",
        )}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon-sm" variant="ghost" onClick={onNew} aria-label="new tab">
              <Plus aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            new tab — ⌥⌘T
          </TooltipContent>
        </Tooltip>
      </div>
    </TabsList>
  );
};
