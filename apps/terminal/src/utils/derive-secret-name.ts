// Derive a keychain label from the env var when the user leaves the name
// blank: ANTHROPIC_API_KEY -> anthropic-api-key. Matches the server's
// secretNameSchema (^[A-Za-z0-9][A-Za-z0-9_-]*$); returns the empty string if
// the env var doesn't reduce to a valid name (so the caller still errors).
export const deriveSecretName = (environmentVariable: string): string =>
  environmentVariable
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
