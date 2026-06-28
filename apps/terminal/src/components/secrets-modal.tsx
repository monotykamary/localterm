import { Boxes, Key, Pencil, Plus, Trash2, X } from "lucide-react";
import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { SecretSelector } from "@/components/secret-selector";
import {
  COMMAND_PALETTE_BACKDROP_CLASSES,
  COMMAND_PALETTE_PANEL_CLASSES,
  MODAL_PANEL_CLASSES,
} from "@/lib/animation-classes";
import {
  SECRETS_BODY_MIN_HEIGHT_PX,
  SECRETS_LIST_ROW_HEIGHT_PX,
  SECRETS_MODAL_CLOSE_TRANSITION_MS,
  SECRETS_MODAL_MAX_HEIGHT_PX,
} from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { Process, SecretEntryResponse } from "@monotykamary/localterm-server/protocol";
import { deleteProcess, fetchProcesses, putProcess } from "@/utils/fetch-processes";
import { deleteSecret, fetchSecrets, putSecret } from "@/utils/fetch-secrets";

interface SecretsModalProps {
  open: boolean;
  onClose: () => void;
}

type ModalTab = "secrets" | "processes";

// A secret's name is the Keychain label and the join key processes/automations
// reference, so it is immutable: editing only changes envVar (and optionally
// re-sets the value); a rename is a delete + recreate.
interface SecretEditForm {
  originalName: string | null;
  name: string;
  envVar: string;
  value: string;
}

// A process's name is the shim filename and the identity the delete cascade
// keys on, so it is immutable: editing only changes requestedSecrets.
interface ProcessEditForm {
  originalName: string | null;
  name: string;
  requestedSecrets: string[];
}

const EMPTY_SECRET_FORM: SecretEditForm = {
  originalName: null,
  name: "",
  envVar: "",
  value: "",
};

const EMPTY_PROCESS_FORM: ProcessEditForm = {
  originalName: null,
  name: "",
  requestedSecrets: [],
};

// Derive a keychain label from the env var when the user leaves the name
// blank: ANTHROPIC_API_KEY -> anthropic-api-key. Matches the server's
// secretNameSchema (^[A-Za-z0-9][A-Za-z0-9_-]*$); returns the empty string if
// the env var doesn't reduce to a valid name (so the caller still errors).
const deriveName = (envVar: string): string =>
  envVar
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");

const SecretRow = ({
  secret,
  onEdit,
  onTrashClick,
  isArmed,
  isDeleting,
}: {
  secret: SecretEntryResponse;
  onEdit: () => void;
  onTrashClick: () => void;
  isArmed: boolean;
  isDeleting: boolean;
}) => (
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

const ProcessRow = ({
  process,
  secretEnvVars,
  onEdit,
  onTrashClick,
  isArmed,
  isDeleting,
}: {
  process: Process;
  secretEnvVars: Map<string, string>;
  onEdit: () => void;
  onTrashClick: () => void;
  isArmed: boolean;
  isDeleting: boolean;
}) => (
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

export const SecretsModal = ({ open, onClose }: SecretsModalProps) => {
  const [mounted, setMounted] = useState(false);
  const [settled, setSettled] = useState(false);
  const [tab, setTab] = useState<ModalTab>("secrets");
  const [secrets, setSecrets] = useState<SecretEntryResponse[] | null>(null);
  const [processes, setProcesses] = useState<Process[] | null>(null);
  const [supported, setSupported] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [secretForm, setSecretForm] = useState<SecretEditForm | null>(null);
  const [secretFormError, setSecretFormError] = useState<string | null>(null);
  const [secretSaving, setSecretSaving] = useState(false);
  const [secretDeletingName, setSecretDeletingName] = useState<string | null>(null);
  const [secretArmedDeleteName, setSecretArmedDeleteName] = useState<string | null>(null);
  const [processForm, setProcessForm] = useState<ProcessEditForm | null>(null);
  const [processFormError, setProcessFormError] = useState<string | null>(null);
  const [processSaving, setProcessSaving] = useState(false);
  const [processDeletingName, setProcessDeletingName] = useState<string | null>(null);
  const [processArmedDeleteName, setProcessArmedDeleteName] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const listScrollRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async () => {
    const [fetchedSecrets, fetchedProcesses] = await Promise.all([
      fetchSecrets(),
      fetchProcesses(),
    ]);
    if (fetchedSecrets === null || fetchedProcesses === null) {
      setHasError(true);
      return;
    }
    setHasError(false);
    setSupported(fetchedSecrets.supported);
    setSecrets(fetchedSecrets.secrets);
    setProcesses(fetchedProcesses);
  }, []);

  // Mount/unmount + open/close animation mirrors the sessions/ports/worktrees
  // modals. The panel is focused on open so the terminal's textarea releases
  // focus before any field is interacted with — without this xterm retains
  // focus and steals keystrokes from the modal's inputs.
  useEffect(() => {
    if (open) {
      setMounted(true);
      setSecretForm(null);
      setSecretFormError(null);
      setSecretArmedDeleteName(null);
      setProcessForm(null);
      setProcessFormError(null);
      setProcessArmedDeleteName(null);
      const frame = requestAnimationFrame(() => {
        setSettled(true);
        panelRef.current?.focus();
      });
      return () => cancelAnimationFrame(frame);
    }
    setSettled(false);
    setSecretArmedDeleteName(null);
    setProcessArmedDeleteName(null);
    if (mounted) {
      const timer = window.setTimeout(() => setMounted(false), SECRETS_MODAL_CLOSE_TRANSITION_MS);
      return () => window.clearTimeout(timer);
    }
  }, [open, mounted]);

  useEffect(() => {
    if (!open) return;
    void refresh();
  }, [open, refresh]);

  const secretsList = secrets ?? [];
  const virtualizer = useVirtualizer({
    count: secretsList.length,
    getScrollElement: () => listScrollRef.current,
    estimateSize: () => SECRETS_LIST_ROW_HEIGHT_PX,
    overscan: 8,
    getItemKey: (index) => secretsList[index].name,
  });
  // The list div gets an explicit pixel height (the virtualizer's total) so the
  // absolute-positioned rows have a sizing container; the intro/form/empty
  // state flow naturally above it inside the scroll element. No measurement
  // effect — getTotalSize() is read directly each render, so the body grows as
  // rows measure. Mirrors the worktrees modal (which never subtracted
  // scrollHeight - getTotalSize(); that earlier approach under-sized the body
  // on first open before rows measured, leaving only the first row visible).
  const secretListHeightPx = hasError
    ? SECRETS_BODY_MIN_HEIGHT_PX
    : Math.max(SECRETS_LIST_ROW_HEIGHT_PX, virtualizer.getTotalSize());

  // Escape closes (capture phase, winning over the terminal's own handling
  // while the modal is up); a visible form on either tab cancels back to the
  // list first so an accidental esc doesn't drop unsaved edits silently.
  useEffect(() => {
    if (!open || !mounted) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (secretForm) setSecretForm(null);
      else if (processForm) setProcessForm(null);
      else onClose();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [open, mounted, secretForm, processForm, onClose]);

  const switchTab = (next: ModalTab) => {
    setTab(next);
    setSecretForm(null);
    setSecretFormError(null);
    setSecretArmedDeleteName(null);
    setProcessForm(null);
    setProcessFormError(null);
    setProcessArmedDeleteName(null);
  };

  const startAddSecret = () => {
    setSecretFormError(null);
    setSecretForm({ ...EMPTY_SECRET_FORM });
  };

  const startEditSecret = (secret: SecretEntryResponse) => {
    setSecretFormError(null);
    setSecretForm({
      originalName: secret.name,
      name: secret.name,
      envVar: secret.envVar,
      value: "",
    });
  };

  const handleSaveSecret = async () => {
    if (!secretForm) return;
    const envVar = secretForm.envVar.trim();
    if (!envVar) {
      setSecretFormError("Environment variable is required.");
      return;
    }
    const isEditing = secretForm.originalName !== null;
    const name = isEditing
      ? secretForm.originalName!
      : secretForm.name.trim() || deriveName(envVar);
    if (!name) {
      setSecretFormError("Enter a name or a valid environment variable to derive one from.");
      return;
    }
    // A new secret needs a value (the daemon rejects a value-less create); an
    // edit leaves the value untouched when blank.
    if (!isEditing && !secretForm.value) {
      setSecretFormError("Enter a value for the new secret.");
      return;
    }
    setSecretSaving(true);
    setSecretFormError(null);
    const result = await putSecret(name, {
      envVar,
      ...(secretForm.value ? { value: secretForm.value } : {}),
    });
    setSecretSaving(false);
    if (!result) {
      setSecretFormError(
        "Couldn't save. Check the name/env var format and that the daemon is running.",
      );
      return;
    }
    setSecretForm(null);
    void refresh();
  };

  // Two-tap delete mirroring the worktrees modal: the first tap arms (icon
  // turns red, aria-label becomes "confirm delete"), the second tap confirms.
  // Tapping a different row re-arms that one. Resets on close/tab switch.
  const handleSecretTrashClick = (name: string) => {
    if (secretArmedDeleteName !== name) {
      setSecretArmedDeleteName(name);
      return;
    }
    void confirmDeleteSecret(name);
  };
  const confirmDeleteSecret = async (name: string) => {
    setSecretArmedDeleteName(null);
    setSecretDeletingName(name);
    const ok = await deleteSecret(name);
    setSecretDeletingName(null);
    if (ok) void refresh();
  };

  const startAddProcess = () => {
    setProcessFormError(null);
    setProcessForm({ ...EMPTY_PROCESS_FORM });
  };

  const startEditProcess = (process: Process) => {
    setProcessFormError(null);
    setProcessForm({
      originalName: process.name,
      name: process.name,
      requestedSecrets: [...process.requestedSecrets],
    });
  };

  const handleSaveProcess = async () => {
    if (!processForm) return;
    const isEditing = processForm.originalName !== null;
    const name = isEditing ? processForm.originalName! : processForm.name.trim();
    if (!name) {
      setProcessFormError("Enter a binary name (e.g. pi).");
      return;
    }
    setProcessSaving(true);
    setProcessFormError(null);
    const result = await putProcess(name, processForm.requestedSecrets);
    setProcessSaving(false);
    if (!result) {
      setProcessFormError(
        "Couldn't save. Check the binary name and that every selected secret still exists.",
      );
      return;
    }
    setProcessForm(null);
    void refresh();
  };

  const handleProcessTrashClick = (name: string) => {
    if (processArmedDeleteName !== name) {
      setProcessArmedDeleteName(name);
      return;
    }
    void confirmDeleteProcess(name);
  };
  const confirmDeleteProcess = async (name: string) => {
    setProcessArmedDeleteName(null);
    setProcessDeletingName(name);
    const ok = await deleteProcess(name);
    setProcessDeletingName(null);
    if (ok) void refresh();
  };

  if (!mounted) return null;
  const isVisible = open && settled;
  const isEditingSecret = secretForm !== null && secretForm.originalName !== null;
  const isEditingProcess = processForm !== null && processForm.originalName !== null;
  const processesList = processes ?? [];
  const secretEnvVars = new Map(secretsList.map((secret) => [secret.name, secret.envVar]));
  const activeCount = tab === "secrets" ? secrets?.length : processes?.length;
  const activeFormOpen = tab === "secrets" ? secretForm !== null : processForm !== null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[18vh]">
      <div
        data-open={isVisible || undefined}
        data-closed={!isVisible || undefined}
        className={cn(COMMAND_PALETTE_BACKDROP_CLASSES)}
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-label="manage secrets and processes"
        aria-modal
        tabIndex={-1}
        data-open={isVisible || undefined}
        data-closed={!isVisible || undefined}
        className={cn(
          "relative z-10 flex w-[480px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl outline-none origin-top",
          MODAL_PANEL_CLASSES,
          COMMAND_PALETTE_PANEL_CLASSES,
        )}
        style={{ maxHeight: SECRETS_MODAL_MAX_HEIGHT_PX }}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border/40 px-4 py-2.5">
          <div className="flex shrink-0 items-center gap-2 text-sm font-medium text-foreground">
            <Key className="size-4 text-muted-foreground" aria-hidden="true" />
            <div
              role="tablist"
              aria-label="secrets view"
              className="flex items-center rounded-md border border-border/60 p-0.5"
            >
              {(
                [
                  ["secrets", "Secrets"],
                  ["processes", "Processes"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={tab === value}
                  onClick={() => switchTab(value)}
                  className={cn(
                    "rounded-sm px-2 py-0.5 text-xs transition-colors",
                    tab === value
                      ? "bg-foreground/10 text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {activeCount === undefined && !hasError ? (
              <Spinner className="size-3.5" aria-label="loading" />
            ) : (
              <span className="font-mono text-[10px] tabular-nums text-muted-foreground/60">
                {activeCount ?? 0}
              </span>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="close"
              className="hover:text-foreground"
              onClick={onClose}
            >
              <X />
            </Button>
          </div>
        </div>

        <div
          ref={listScrollRef}
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <div className="animate-in fade-in-0 duration-150 ease-snappy">
            {hasError ? (
              <div
                className="flex flex-col items-center justify-center gap-3 px-2.5 py-6 text-center text-sm text-muted-foreground/70"
                style={{ minHeight: SECRETS_BODY_MIN_HEIGHT_PX }}
              >
                Couldn't load from the localterm daemon.
                <Button variant="outline" size="xs" onClick={() => void refresh()}>
                  Retry
                </Button>
              </div>
            ) : tab === "secrets" ? (
              <>
                <div className="px-2.5 pb-2 pt-1 text-[11px] leading-relaxed text-muted-foreground/60">
                  Stored in your macOS Keychain — never on disk. A secret is just a name + the env
                  var it exports. Wire it to a binary on the Processes tab so only that program (via
                  a PATH shim) ever sees the value.
                </div>

                {!supported ? (
                  <div className="mx-2.5 mb-2 rounded-sm border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
                    Secret storage isn't supported on this server's platform (it uses macOS
                    Keychain). Run the localterm daemon on a Mac to manage secrets here.
                  </div>
                ) : null}

                {secretForm ? (
                  <div className="m-1.5 rounded-sm border border-border/40 bg-muted/20 p-2.5">
                    <div className="flex flex-col gap-2">
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-medium tracking-wide text-muted-foreground/70 uppercase">
                          Name
                        </label>
                        {isEditingSecret ? (
                          <div className="flex h-7 items-center px-2 font-mono text-xs text-foreground">
                            {secretForm.originalName}
                          </div>
                        ) : (
                          <Input
                            value={secretForm.name}
                            name="localterm-secret-name"
                            autoComplete="off"
                            placeholder="auto from env var"
                            aria-label="secret name"
                            onChange={(event) =>
                              setSecretForm({ ...secretForm, name: event.target.value })
                            }
                            className="h-7 px-2 font-mono text-xs"
                          />
                        )}
                        {isEditingSecret ? (
                          <span className="text-[10px] text-muted-foreground/50">
                            Can't rename a secret — delete and recreate to change its name.
                          </span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground/50">
                            Optional. Derived from the env var (e.g. ANTHROPIC_API_KEY →
                            anthropic-api-key) if left blank.
                          </span>
                        )}
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-medium tracking-wide text-muted-foreground/70 uppercase">
                          Environment variable
                        </label>
                        <Input
                          value={secretForm.envVar}
                          autoFocus
                          name="localterm-secret-envvar"
                          autoComplete="off"
                          placeholder="ANTHROPIC_API_KEY"
                          aria-label="environment variable name"
                          onChange={(event) =>
                            setSecretForm({ ...secretForm, envVar: event.target.value })
                          }
                          className="h-7 px-2 font-mono text-xs"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-medium tracking-wide text-muted-foreground/70 uppercase">
                          {isEditingSecret ? "New value (optional)" : "Value"}
                        </label>
                        <Input
                          type="password"
                          value={secretForm.value}
                          name="localterm-secret-value"
                          placeholder={isEditingSecret ? "Leave blank to keep current" : ""}
                          aria-label="secret value"
                          autoComplete="new-password"
                          onChange={(event) =>
                            setSecretForm({ ...secretForm, value: event.target.value })
                          }
                          className="h-7 px-2 font-mono text-xs"
                        />
                      </div>
                      {secretFormError ? (
                        <div className="text-[11px] text-red-500 dark:text-red-400">
                          {secretFormError}
                        </div>
                      ) : null}
                      <div className="flex items-center justify-end gap-1.5 pt-1">
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => setSecretForm(null)}
                          disabled={secretSaving}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="xs"
                          onClick={() => void handleSaveSecret()}
                          disabled={secretSaving}
                        >
                          {secretSaving ? <Spinner className="size-3.5" /> : "Save"}
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : null}

                {secretsList.length === 0 && !secretForm ? (
                  <div className="flex flex-col items-center justify-center gap-2 px-2.5 py-6 text-center text-sm text-muted-foreground/70">
                    No secrets yet.
                    {supported ? (
                      <Button variant="outline" size="xs" onClick={startAddSecret}>
                        <Plus className="size-3.5" aria-hidden="true" />
                        Add a secret
                      </Button>
                    ) : null}
                  </div>
                ) : null}
                {secretsList.length > 0 ? (
                  <div
                    style={{
                      height: `${secretListHeightPx}px`,
                      width: "100%",
                      position: "relative",
                    }}
                  >
                    {virtualizer.getVirtualItems().map((virtualRow: VirtualItem) => {
                      const secret = secretsList[virtualRow.index];
                      return (
                        <div
                          key={secret.name}
                          ref={virtualizer.measureElement}
                          data-index={virtualRow.index}
                          style={
                            {
                              position: "absolute",
                              top: 0,
                              left: 0,
                              width: "100%",
                              transform: `translateY(${virtualRow.start}px)`,
                            } satisfies CSSProperties
                          }
                        >
                          <SecretRow
                            secret={secret}
                            onEdit={() => startEditSecret(secret)}
                            onTrashClick={() => handleSecretTrashClick(secret.name)}
                            isArmed={secretArmedDeleteName === secret.name}
                            isDeleting={secretDeletingName === secret.name}
                          />
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <div className="px-2.5 pb-2 pt-1 text-[11px] leading-relaxed text-muted-foreground/60">
                  A process is a binary localterm wraps with a PATH shim. Select which secrets it
                  receives; the shim resolves them from the Keychain and exports them only for that
                  program.
                </div>

                {processForm ? (
                  <div className="m-1.5 rounded-sm border border-border/40 bg-muted/20 p-2.5">
                    <div className="flex flex-col gap-2">
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-medium tracking-wide text-muted-foreground/70 uppercase">
                          Binary name
                        </label>
                        {isEditingProcess ? (
                          <div className="flex h-7 items-center px-2 font-mono text-xs text-foreground">
                            {processForm.originalName}
                          </div>
                        ) : (
                          <Input
                            value={processForm.name}
                            autoFocus
                            name="localterm-process-name"
                            autoComplete="off"
                            placeholder="pi"
                            aria-label="process binary name"
                            onChange={(event) =>
                              setProcessForm({ ...processForm, name: event.target.value })
                            }
                            className="h-7 px-2 font-mono text-xs"
                          />
                        )}
                        {isEditingProcess ? (
                          <span className="text-[10px] text-muted-foreground/50">
                            Can't rename a process — delete and recreate to change its name.
                          </span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground/50">
                            The binary the shim shadows (one name, e.g. pi or claude).
                          </span>
                        )}
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <span className="text-[10px] font-medium tracking-wide text-muted-foreground/70 uppercase">
                          Secrets to expose
                        </span>
                        {secretsList.length === 0 ? (
                          <span className="text-[10px] text-muted-foreground/60">
                            No secrets configured. Add one on the Secrets tab first.
                          </span>
                        ) : (
                          <SecretSelector
                            selected={processForm.requestedSecrets}
                            options={secretsList}
                            onChange={(requestedSecrets) =>
                              setProcessForm({ ...processForm, requestedSecrets })
                            }
                          />
                        )}
                      </div>
                      {processFormError ? (
                        <div className="text-[11px] text-red-500 dark:text-red-400">
                          {processFormError}
                        </div>
                      ) : null}
                      <div className="flex items-center justify-end gap-1.5 pt-1">
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => setProcessForm(null)}
                          disabled={processSaving}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="xs"
                          onClick={() => void handleSaveProcess()}
                          disabled={processSaving}
                        >
                          {processSaving ? <Spinner className="size-3.5" /> : "Save"}
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : null}

                {processesList.length === 0 && !processForm ? (
                  <div className="flex flex-col items-center justify-center gap-2 px-2.5 py-6 text-center text-sm text-muted-foreground/70">
                    No processes yet.
                    <Button variant="outline" size="xs" onClick={startAddProcess}>
                      <Plus className="size-3.5" aria-hidden="true" />
                      Add a process
                    </Button>
                  </div>
                ) : null}
                {processesList.length > 0 ? (
                  <div>
                    {processesList.map((process) => (
                      <ProcessRow
                        key={process.name}
                        process={process}
                        secretEnvVars={secretEnvVars}
                        onEdit={() => startEditProcess(process)}
                        onTrashClick={() => handleProcessTrashClick(process.name)}
                        isArmed={processArmedDeleteName === process.name}
                        isDeleting={processDeletingName === process.name}
                      />
                    ))}
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>

        <div className="flex items-center border-t border-border/40 px-4 py-1.5 text-[10px] text-muted-foreground/60">
          {!hasError && tab === "secrets" && supported ? (
            <Button
              variant="ghost"
              size="xs"
              onClick={startAddSecret}
              disabled={secretForm !== null}
              className="text-muted-foreground hover:text-foreground"
            >
              <Plus className="size-3.5" aria-hidden="true" />
              New secret
            </Button>
          ) : null}
          {!hasError && tab === "processes" ? (
            <Button
              variant="ghost"
              size="xs"
              onClick={startAddProcess}
              disabled={processForm !== null}
              className="text-muted-foreground hover:text-foreground"
            >
              <Plus className="size-3.5" aria-hidden="true" />
              New process
            </Button>
          ) : null}
          <span className="ml-auto flex items-center gap-1">
            <kbd className="rounded border border-border/40 bg-muted/30 px-1 font-mono text-[10px]">
              esc
            </kbd>
            {activeFormOpen ? "cancel" : "close"}
          </span>
        </div>
      </div>
    </div>
  );
};
