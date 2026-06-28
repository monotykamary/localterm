import { Key, Pencil, Plus, Trash2, X } from "lucide-react";
import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
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
import type { SecretEntryResponse } from "@monotykamary/localterm-server/protocol";
import { deleteSecret, fetchSecrets, putSecret } from "@/utils/fetch-secrets";

interface SecretsModalProps {
  open: boolean;
  onClose: () => void;
}

// `originalName` distinguishes add (null) from edit (the existing name). The
// name field is always editable: renaming an existing secret deletes the old
// name's value (the backend has no value-move API — values are opaque to the
// daemon) and creates the new one, so a rename requires re-entering the value.
interface EditForm {
  originalName: string | null;
  name: string;
  envVar: string;
  programs: string;
  value: string;
}

const EMPTY_FORM: EditForm = {
  originalName: null,
  name: "",
  envVar: "",
  programs: "",
  value: "",
};

const parsePrograms = (raw: string): string[] =>
  Array.from(
    new Set(
      raw
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  );

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
      <div className="mt-1 flex flex-wrap gap-1">
        {secret.programs.length === 0 ? (
          <span className="text-[11px] italic text-muted-foreground/50">no programs</span>
        ) : (
          secret.programs.map((program) => (
            <span
              key={program}
              className="rounded-sm border border-border/40 bg-muted/30 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/80"
            >
              {program}
            </span>
          ))
        )}
      </div>
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

export const SecretsModal = ({ open, onClose }: SecretsModalProps) => {
  const [mounted, setMounted] = useState(false);
  const [settled, setSettled] = useState(false);
  const [secrets, setSecrets] = useState<SecretEntryResponse[] | null>(null);
  const [supported, setSupported] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [form, setForm] = useState<EditForm | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingName, setDeletingName] = useState<string | null>(null);
  const [armedDeleteName, setArmedDeleteName] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [staticHeight, setStaticHeight] = useState(0);

  const refresh = useCallback(async () => {
    const fetched = await fetchSecrets();
    if (fetched === null) {
      setHasError(true);
      return;
    }
    setHasError(false);
    setSupported(fetched.supported);
    setSecrets(fetched.secrets);
  }, []);

  // Mount/unmount + open/close animation mirrors the sessions/ports/worktrees
  // modals: CSS transitions on data-open/data-closed with a settle window. The
  // panel is focused on open so the terminal's textarea releases focus before
  // any field is interacted with — without this xterm retains focus and
  // steals keystrokes from the modal's inputs.
  useEffect(() => {
    if (open) {
      setMounted(true);
      setForm(null);
      setFormError(null);
      setArmedDeleteName(null);
      const frame = requestAnimationFrame(() => {
        setSettled(true);
        panelRef.current?.focus();
      });
      return () => cancelAnimationFrame(frame);
    }
    setSettled(false);
    setArmedDeleteName(null);
    if (mounted) {
      const timer = window.setTimeout(() => setMounted(false), SECRETS_MODAL_CLOSE_TRANSITION_MS);
      return () => window.clearTimeout(timer);
    }
  }, [open]);

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

  // The list is virtualized with an explicit pixel height (the virtualizer's
  // total), so the body height is computed: staticHeight + list total. The
  // static content around the list — intro, unsupported banner, inline form,
  // empty state — is variable-height, so it's measured here. The fade-in
  // container holds both the static content and the list, so its scrollHeight
  // is static + list total; subtracting the list total yields the static
  // height. This mirrors the ports/sessions/worktrees height-reserved body:
  // the panel opens at the reserve, then transitions to the computed height
  // (and re-expands when the form opens) instead of snapping. `useEffect`
  // (after paint) so the reserve paints first and the transition has a start
  // point; `scrollHeight` is layout-based so the concurrent fade-in doesn't
  // skew the measure.
  useEffect(() => {
    if (hasError || secrets === null) {
      setStaticHeight(0);
      return;
    }
    const el = contentRef.current;
    if (!el) return;
    setStaticHeight(el.scrollHeight - virtualizer.getTotalSize());
  }, [secrets, hasError, supported, form, formError, virtualizer]);

  // Escape closes (capture phase, winning over the terminal's own handling
  // while the modal is up); a visible form cancels back to the list first so
  // an accidental esc doesn't drop unsaved edits silently.
  useEffect(() => {
    if (!open || !mounted) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (form) setForm(null);
      else onClose();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [open, mounted, form, onClose]);

  const startAdd = () => {
    setFormError(null);
    setForm({ ...EMPTY_FORM });
  };

  const startEdit = (secret: SecretEntryResponse) => {
    setFormError(null);
    setForm({
      originalName: secret.name,
      name: secret.name,
      envVar: secret.envVar,
      programs: secret.programs.join(", "),
      value: "",
    });
  };

  const handleSave = async () => {
    if (!form) return;
    const envVar = form.envVar.trim();
    if (!envVar) {
      setFormError("Environment variable is required.");
      return;
    }
    const name = form.name.trim() || deriveName(envVar);
    if (!name) {
      setFormError("Enter a name or a valid environment variable to derive one from.");
      return;
    }
    const isRename = form.originalName !== null && form.originalName !== name;
    // Renaming changes the backend key; the daemon has no value-move API (it
    // never reads secret values), so the old value is unreachable under the new
    // name. Require a fresh value on rename, then delete the old name.
    if (isRename && !form.value) {
      setFormError("Enter a value for the new name — the key can't be moved.");
      return;
    }
    const programs = parsePrograms(form.programs);
    setSaving(true);
    setFormError(null);
    if (isRename) {
      await deleteSecret(form.originalName!);
    }
    const result = await putSecret(name, {
      envVar,
      programs,
      ...(form.value ? { value: form.value } : {}),
    });
    setSaving(false);
    if (!result) {
      setFormError("Couldn't save. Check the name/env var format and that the daemon is running.");
      return;
    }
    setForm(null);
    void refresh();
  };

  // Two-tap delete mirroring the worktrees modal: the first tap arms (icon
  // turns red, aria-label becomes "confirm delete"), the second tap confirms.
  // Tapping a different row's trash re-arms that one. Resets on close.
  const handleTrashClick = (name: string) => {
    if (armedDeleteName !== name) {
      setArmedDeleteName(name);
      return;
    }
    void confirmDelete(name);
  };
  const confirmDelete = async (name: string) => {
    setArmedDeleteName(null);
    setDeletingName(name);
    const ok = await deleteSecret(name);
    setDeletingName(null);
    if (ok) void refresh();
  };

  if (!mounted) return null;
  const isVisible = open && settled;
  const isEditing = form !== null && form.originalName !== null;
  const listTotal = secrets && !hasError ? virtualizer.getTotalSize() : 0;
  const bodyHeight =
    hasError || secrets === null || staticHeight === 0
      ? SECRETS_BODY_MIN_HEIGHT_PX
      : Math.max(SECRETS_BODY_MIN_HEIGHT_PX, staticHeight + listTotal);

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
        aria-label="manage secrets"
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
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Key className="size-4 text-muted-foreground" aria-hidden="true" />
            Secrets
          </div>
          <div className="flex items-center gap-2">
            {secrets === null && !hasError ? (
              <Spinner className="size-3.5" aria-label="loading secrets" />
            ) : secrets ? (
              <span className="font-mono text-[10px] tabular-nums text-muted-foreground/60">
                {secrets.length}
              </span>
            ) : null}
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
          <div
            className="relative overflow-hidden transition-[height] duration-150 ease-snappy"
            style={{ height: bodyHeight }}
          >
            {hasError ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-2.5 text-sm text-muted-foreground/70">
                Couldn't load secrets from the localterm daemon.
                <Button variant="outline" size="xs" onClick={() => void refresh()}>
                  Retry
                </Button>
              </div>
            ) : secrets === null ? null : (
              <div ref={contentRef} className="animate-in fade-in-0 duration-150 ease-snappy">
                <div className="px-2.5 pb-2 pt-1 text-[11px] leading-relaxed text-muted-foreground/60">
                  Stored in your macOS Keychain — never on disk. localterm injects a secret only
                  into the programs listed on its row, via a PATH shim, so{" "}
                  <code className="font-mono">ls</code> in the same tab never sees your keys.
                </div>

                {!supported ? (
                  <div className="mx-2.5 mb-2 rounded-sm border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
                    Secret storage isn't supported on this server's platform (it uses macOS
                    Keychain). Run the localterm daemon on a Mac to manage secrets here.
                  </div>
                ) : null}

                {form ? (
                  <div className="m-1.5 rounded-sm border border-border/40 bg-muted/20 p-2.5">
                    <div className="flex flex-col gap-2">
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-medium tracking-wide text-muted-foreground/70 uppercase">
                          Name
                        </label>
                        <Input
                          value={form.name}
                          name="localterm-secret-name"
                          autoComplete="off"
                          placeholder="auto from env var"
                          aria-label="secret name"
                          onChange={(event) => setForm({ ...form, name: event.target.value })}
                          className="h-7 px-2 font-mono text-xs"
                        />
                        <span className="text-[10px] text-muted-foreground/50">
                          Optional. Derived from the env var (e.g. ANTHROPIC_API_KEY →
                          anthropic-api-key) if left blank.
                        </span>
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-medium tracking-wide text-muted-foreground/70 uppercase">
                          Environment variable
                        </label>
                        <Input
                          value={form.envVar}
                          autoFocus
                          name="localterm-secret-envvar"
                          autoComplete="off"
                          placeholder="ANTHROPIC_API_KEY"
                          aria-label="environment variable name"
                          onChange={(event) => setForm({ ...form, envVar: event.target.value })}
                          className="h-7 px-2 font-mono text-xs"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-medium tracking-wide text-muted-foreground/70 uppercase">
                          Programs
                        </label>
                        <Input
                          value={form.programs}
                          name="localterm-secret-programs"
                          autoComplete="off"
                          placeholder="pi, claude"
                          aria-label="programs that receive this secret"
                          onChange={(event) => setForm({ ...form, programs: event.target.value })}
                          className="h-7 px-2 font-mono text-xs"
                        />
                        <span className="text-[10px] text-muted-foreground/50">
                          Comma-separated binary names. A PATH shim wraps each one.
                        </span>
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-medium tracking-wide text-muted-foreground/70 uppercase">
                          {isEditing ? "New value (optional)" : "Value"}
                        </label>
                        <Input
                          type="password"
                          value={form.value}
                          name="localterm-secret-value"
                          placeholder={isEditing ? "Leave blank to keep current" : ""}
                          aria-label="secret value"
                          autoComplete="new-password"
                          onChange={(event) => setForm({ ...form, value: event.target.value })}
                          className="h-7 px-2 font-mono text-xs"
                        />
                        {isEditing ? (
                          <span className="text-[10px] text-muted-foreground/50">
                            Renaming the name requires a new value (the key can't be moved).
                          </span>
                        ) : null}
                      </div>
                      {formError ? (
                        <div className="text-[11px] text-red-500 dark:text-red-400">
                          {formError}
                        </div>
                      ) : null}
                      <div className="flex items-center justify-end gap-1.5 pt-1">
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => setForm(null)}
                          disabled={saving}
                        >
                          Cancel
                        </Button>
                        <Button size="xs" onClick={() => void handleSave()} disabled={saving}>
                          {saving ? <Spinner className="size-3.5" /> : "Save"}
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : null}

                {secretsList.length === 0 && !form ? (
                  <div className="flex flex-col items-center justify-center gap-2 px-2.5 py-6 text-center text-sm text-muted-foreground/70">
                    No secrets yet.
                    {supported ? (
                      <Button variant="outline" size="xs" onClick={startAdd}>
                        <Plus className="size-3.5" aria-hidden="true" />
                        Add a secret
                      </Button>
                    ) : null}
                  </div>
                ) : null}
                {secretsList.length > 0 ? (
                  <div
                    style={{
                      height: `${virtualizer.getTotalSize()}px`,
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
                            onEdit={() => startEdit(secret)}
                            onTrashClick={() => handleTrashClick(secret.name)}
                            isArmed={armedDeleteName === secret.name}
                            isDeleting={deletingName === secret.name}
                          />
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center border-t border-border/40 px-4 py-1.5 text-[10px] text-muted-foreground/60">
          {supported && secrets ? (
            <Button
              variant="ghost"
              size="xs"
              onClick={startAdd}
              disabled={form !== null}
              className="text-muted-foreground hover:text-foreground"
            >
              <Plus className="size-3.5" aria-hidden="true" />
              New secret
            </Button>
          ) : null}
          <span className="ml-auto flex items-center gap-1">
            <kbd className="rounded border border-border/40 bg-muted/30 px-1 font-mono text-[10px]">
              esc
            </kbd>
            {form ? "cancel" : "close"}
          </span>
        </div>
      </div>
    </div>
  );
};
