import type { SecretEntryResponse } from "@monotykamary/localterm-server/protocol";
import { useState } from "react";
import { deleteSecret, putSecret } from "@/utils/fetch-secrets";
import { deriveSecretName } from "@/utils/derive-secret-name";

// A secret's name is the Keychain label and the join key processes/automations
// reference, so it is immutable: editing only changes envVar (and optionally
// re-sets the value); a rename is a delete + recreate.
export interface SecretEditFormState {
  originalName: string | null;
  name: string;
  envVar: string;
  value: string;
}

interface SecretActions {
  form: SecretEditFormState | null;
  formError: string | null;
  isSaving: boolean;
  deletingName: string | null;
  armedDeleteName: string | null;
  startAdd: () => void;
  startEdit: (secret: SecretEntryResponse) => void;
  updateForm: (form: SecretEditFormState) => void;
  cancelForm: () => void;
  save: () => Promise<void>;
  handleTrashClick: (name: string) => void;
  reset: () => void;
  clearArmedDelete: () => void;
}

const EMPTY_SECRET_FORM: SecretEditFormState = {
  originalName: null,
  name: "",
  envVar: "",
  value: "",
};

export const useSecretActions = (refresh: () => Promise<void>): SecretActions => {
  const [form, setForm] = useState<SecretEditFormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingName, setDeletingName] = useState<string | null>(null);
  const [armedDeleteName, setArmedDeleteName] = useState<string | null>(null);

  const startAdd = () => {
    setFormError(null);
    setForm({ ...EMPTY_SECRET_FORM });
  };

  const startEdit = (secret: SecretEntryResponse) => {
    setFormError(null);
    setForm({
      originalName: secret.name,
      name: secret.name,
      envVar: secret.envVar,
      value: "",
    });
  };

  const save = async () => {
    if (!form) return;
    const envVar = form.envVar.trim();
    if (!envVar) {
      setFormError("Environment variable is required.");
      return;
    }
    const isEditing = form.originalName !== null;
    const name = form.originalName ?? (form.name.trim() || deriveSecretName(envVar));
    if (!name) {
      setFormError("Enter a name or a valid environment variable to derive one from.");
      return;
    }
    // A new secret needs a value (the daemon rejects a value-less create); an
    // edit leaves the value untouched when blank.
    if (!isEditing && !form.value) {
      setFormError("Enter a value for the new secret.");
      return;
    }
    setIsSaving(true);
    setFormError(null);
    const result = await putSecret(name, {
      envVar,
      ...(form.value ? { value: form.value } : {}),
    });
    setIsSaving(false);
    if (!result) {
      setFormError("Couldn't save. Check the name/env var format and that the daemon is running.");
      return;
    }
    setForm(null);
    void refresh();
  };

  const confirmDelete = async (name: string) => {
    setArmedDeleteName(null);
    setDeletingName(name);
    const didDelete = await deleteSecret(name);
    setDeletingName(null);
    if (didDelete) void refresh();
  };

  // Two-tap delete mirroring the worktrees modal: the first tap arms (icon
  // turns red, aria-label becomes "confirm delete"), the second tap confirms.
  // Tapping a different row re-arms that one. Resets on close/tab switch.
  const handleTrashClick = (name: string) => {
    if (armedDeleteName !== name) {
      setArmedDeleteName(name);
      return;
    }
    void confirmDelete(name);
  };

  const reset = () => {
    setForm(null);
    setFormError(null);
    setArmedDeleteName(null);
  };

  return {
    form,
    formError,
    isSaving,
    deletingName,
    armedDeleteName,
    startAdd,
    startEdit,
    updateForm: setForm,
    cancelForm: () => setForm(null),
    save,
    handleTrashClick,
    reset,
    clearArmedDelete: () => setArmedDeleteName(null),
  };
};
