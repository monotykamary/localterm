import type { SecretBackend } from "@monotykamary/localterm-server/secret-backend";
const SECRET_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export const trySecretGetFastPath = async (
  arguments_: readonly string[],
  backend?: SecretBackend,
): Promise<boolean> => {
  if (
    arguments_.length !== 3 ||
    arguments_[0] !== "secret" ||
    arguments_[1] !== "get" ||
    !SECRET_NAME_PATTERN.test(arguments_[2] ?? "")
  ) {
    return false;
  }
  const { runSecretGet } = await import("./commands/secret-get.js");
  await runSecretGet(arguments_[2], backend);
  return true;
};
