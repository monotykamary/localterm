import {Check, Copy} from "lucide-react";
import type {TerminalExitInfo} from "@/hooks/use-terminal-runtime";
import {RESTART_COMMAND} from "@/lib/constants";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {Spinner} from "@/components/ui/spinner";

interface ConnectionStatusDialogProps {
  open: boolean;
  exitInfo: TerminalExitInfo | null;
  hasCopiedRestartCommand: boolean;
  isRetryingConnection: boolean;
  onCopyRestartCommand: () => void;
  onOpenNewShell: () => void;
  onRetryConnection: () => void;
}

export const ConnectionStatusDialog = ({
  open,
  exitInfo,
  hasCopiedRestartCommand,
  isRetryingConnection,
  onCopyRestartCommand,
  onOpenNewShell,
  onRetryConnection,
}: ConnectionStatusDialogProps) => (
  <AlertDialog open={open}>
    <AlertDialogContent>
      {exitInfo !== null ? (
        exitInfo.reason === "shell-exited" ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle className="text-sm">Shell ended</AlertDialogTitle>
              <AlertDialogDescription>
                {exitInfo.exitCode === null || exitInfo.exitCode === 0
                  ? "Open a new shell to keep going, or close this tab."
                  : `Exit code ${exitInfo.exitCode}. Open a new shell to keep going.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogAction onClick={onOpenNewShell}>New shell</AlertDialogAction>
            </AlertDialogFooter>
          </>
        ) : (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2 text-sm">
                <Spinner aria-hidden="true" role="presentation" aria-label={undefined} />
                Connection lost
              </AlertDialogTitle>
              <AlertDialogDescription>
                The browser lost its connection to the localterm daemon (close code{" "}
                {exitInfo.closeCode}
                {exitInfo.closeReason ? ` · ${exitInfo.closeReason}` : ""}). Reconnecting spawns a
                fresh shell. The previous one can't be reattached.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogAction onClick={onRetryConnection} disabled={isRetryingConnection}>
                {isRetryingConnection ? <Spinner data-icon="inline-start" /> : null}
                Reconnect
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        )
      ) : (
        <>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-sm">
              <Spinner aria-hidden="true" role="presentation" aria-label={undefined} />
              Lost connection
            </AlertDialogTitle>
            <AlertDialogDescription>
              The localterm server isn't responding. Start it again from your terminal, then retry.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <InputGroup>
            <InputGroupInput
              readOnly
              value={RESTART_COMMAND}
              aria-label="restart command"
              className="font-mono"
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-xs"
                onClick={onCopyRestartCommand}
                aria-label={hasCopiedRestartCommand ? "Copied" : "Copy restart command"}
              >
                {hasCopiedRestartCommand ? <Check /> : <Copy />}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          <AlertDialogFooter>
            <AlertDialogAction onClick={onRetryConnection} disabled={isRetryingConnection}>
              {isRetryingConnection ? <Spinner data-icon="inline-start" /> : null}
              Retry
            </AlertDialogAction>
          </AlertDialogFooter>
        </>
      )}
    </AlertDialogContent>
  </AlertDialog>
);
