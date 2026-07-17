import { GitPullRequest } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

interface PullRequestWorktreeFormProps {
  value: string;
  error: string | null;
  isCreating: boolean;
  onChange: (value: string) => void;
  onCreate: () => void;
}

export const PullRequestWorktreeForm = ({
  value,
  error,
  isCreating,
  onChange,
  onCreate,
}: PullRequestWorktreeFormProps) => (
  <div className="flex shrink-0 items-center gap-2 border-b border-border/40 px-4 py-2">
    <GitPullRequest className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
    <Input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onCreate();
        }
      }}
      placeholder="Open PR #1234 as a worktree"
      inputMode="numeric"
      autoFocus
      className="h-6 flex-1 text-xs"
      aria-label="pull request number"
    />
    <Button
      variant="default"
      size="xs"
      onClick={onCreate}
      disabled={isCreating || value.trim() === ""}
    >
      {isCreating ? <Spinner className="size-3" aria-label="creating" /> : "Create"}
    </Button>
    {error ? <span className="shrink-0 text-[10px] text-red-400">{error}</span> : null}
  </div>
);
