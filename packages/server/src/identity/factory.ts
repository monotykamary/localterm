import type { IdentityConfig, IdentityProvider, IdentityProviderDeps } from "./types.js";
import { createHeaderIdentityProvider } from "./header-provider.js";
import { createOidcIdentityProvider } from "./oidc-provider.js";
import { createPasskeyIdentityProvider } from "./passkey-provider.js";

// Build the configured identity provider. `header` ignores the deps (the
// proxy owns the login); `passkey`/`oidc` use them for the signed session
// cookie, the RP ID / redirect origin, and (passkey) the user/credential
// stores. The switch is exhaustive over the `IdentityConfig` union, so adding
// a variant is a new case here + a new schema member.
export const createIdentityProvider = (
  config: IdentityConfig,
  deps: IdentityProviderDeps,
): IdentityProvider => {
  switch (config.provider) {
    case "header":
      return createHeaderIdentityProvider(config);
    case "passkey":
      return createPasskeyIdentityProvider(config, deps);
    case "oidc":
      return createOidcIdentityProvider(config, deps);
  }
};
