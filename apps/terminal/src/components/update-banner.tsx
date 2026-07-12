import { ArrowUpCircle, Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { UPDATE_COPY_FEEDBACK_MS } from "@/lib/constants";

interface UpdateBannerProps {
  latest: string;
}

const UPDATE_COMMAND = "npm install -g @monotykamary/localterm@latest";
const UPDATE_NPX_HINT = "npx @monotykamary/localterm@latest start";

export const UpdateBanner = ({ latest }: UpdateBannerProps) => {
  const [hasCopied, setHasCopied] = useState(false);

  const copyCommand = (): void => {
    void navigator.clipboard
      .writeText(UPDATE_COMMAND)
      .then(() => {
        setHasCopied(true);
        window.setTimeout(() => setHasCopied(false), UPDATE_COPY_FEEDBACK_MS);
      })
      .catch(() => {
        /* clipboard permission denied; user can still select + copy manually */
      });
  };

  return (
    <div className="flex items-start gap-2 rounded-md border border-sky-500/40 bg-sky-500/10 p-2.5 text-sm">
      <ArrowUpCircle className="mt-0.5 size-4 shrink-0 text-sky-400" aria-hidden="true" />
      <div className="flex-1 space-y-0.5">
        <div className="text-foreground">
          A new version is available: <span className="font-mono font-medium">{latest}</span>
        </div>
        <div className="text-xs text-muted-foreground">
          Update with <code className="font-mono">localterm update</code>
          <span className="text-muted-foreground/70"> or </span>
          <code className="font-mono">{UPDATE_NPX_HINT}</code>.
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={copyCommand}
        aria-label="copy update command"
        title={UPDATE_COMMAND}
        className="shrink-0 hover:text-foreground"
      >
        {hasCopied ? <Check className="text-sky-400" /> : <Copy />}
      </Button>
    </div>
  );
};
