import type { SecretEntryResponse } from "@monotykamary/localterm-server/protocol";
import { Key, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

interface SecretRowProps {
  secret: SecretEntryResponse;
  onEdit: () => void;
  onTrashClick: () => void;
  isArmed: boolean;
  isDeleting: boolean;
}

export const SecretRow = ({
  secret,
  onEdit,
  onTrashClick,
  isArmed,
  isDeleting,
}: SecretRowProps) => (
  <div className="flex items-start gap-2 rounded-sm px-2.5 py-2 text-sm outline-none">
    <Key className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-1.5">
        <span className="shrink-0 font-mono text-xs font-semibold text-foreground">
          {secret.name}
        </span>
        {secret.hasValue ? (
          <span className="rounded-sm bg-emerald-500/15 px-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
            set
          </span>
        ) : (
          <span className="rounded-sm bg-amber-500/15 px-1 text-[10px] font-medium text-amber-600 dark:text-amber-400">
            no value
          </span>
        )}
      </div>
      <div className="mt-0.5 font-mono text-[11px] text-muted-foreground/70">{secret.envVar}</div>
    </div>
    <div className="flex shrink-0 items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`edit ${secret.name}`}
        onClick={onEdit}
        className="text-muted-foreground hover:text-foreground"
      >
        <Pencil className="size-3.5" aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={isArmed ? `confirm delete ${secret.name}` : `delete ${secret.name}`}
        disabled={isDeleting}
        onClick={onTrashClick}
        className={cn(
          isArmed
            ? "text-red-400 hover:text-red-400"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        {isDeleting ? (
          <Spinner className="size-3.5 shrink-0" aria-label={`deleting ${secret.name}`} />
        ) : (
          <Trash2 className="size-3.5" aria-hidden="true" />
        )}
      </Button>
    </div>
  </div>
);
