import type { Process } from "@monotykamary/localterm-server/protocol";
import { Boxes, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

interface ProcessRowProps {
  process: Process;
  secretEnvVars: Map<string, string>;
  onEdit: () => void;
  onTrashClick: () => void;
  isArmed: boolean;
  isDeleting: boolean;
}

export const ProcessRow = ({
  process,
  secretEnvVars,
  onEdit,
  onTrashClick,
  isArmed,
  isDeleting,
}: ProcessRowProps) => (
  <div className="flex items-start gap-2 rounded-sm px-2.5 py-2 text-sm outline-none">
    <Boxes className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
    <div className="min-w-0 flex-1">
      <span className="font-mono text-xs font-semibold text-foreground">{process.name}</span>
      <div className="mt-1 flex flex-wrap gap-1">
        {process.requestedSecrets.length === 0 ? (
          <span className="text-[11px] italic text-muted-foreground/50">no secrets</span>
        ) : (
          process.requestedSecrets.map((secretName) => (
            <span
              key={secretName}
              className="inline-flex items-center gap-1 rounded-sm border border-border/40 bg-muted/30 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/90"
            >
              <span>{secretName}</span>
              <span className="text-muted-foreground/50">
                {secretEnvVars.get(secretName) ?? "?"}
              </span>
            </span>
          ))
        )}
      </div>
    </div>
    <div className="flex shrink-0 items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`edit ${process.name}`}
        onClick={onEdit}
        className="text-muted-foreground hover:text-foreground"
      >
        <Pencil className="size-3.5" aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={isArmed ? `confirm delete ${process.name}` : `delete ${process.name}`}
        disabled={isDeleting}
        onClick={onTrashClick}
        className={cn(
          isArmed
            ? "text-red-400 hover:text-red-400"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        {isDeleting ? (
          <Spinner className="size-3.5 shrink-0" aria-label={`deleting ${process.name}`} />
        ) : (
          <Trash2 className="size-3.5" aria-hidden="true" />
        )}
      </Button>
    </div>
  </div>
);
