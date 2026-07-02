import type { IdentityConfig, IdentityProvider, IdentityProviderDeps } from "./types.js";
import { createHeaderIdentityProvider } from "./header-provider.js";
import { createPasskeyIdentityProvider } from "./passkey-provider.js";

// Build the configured identity provider. `header` ignores the deps (the
// proxy owns the login); `passkey` uses them for its session cookie, RP ID,
// and user/credential stores. The switch is exhaustive over the
// `IdentityConfig` union, so adding `oidc` is a new case here + a new schema
// variant.
export const createIdentityProvider = (
  config: IdentityConfig,
  deps: IdentityProviderDeps,
): IdentityProvider => {
  switch (config.provider) {
    case "header":
      return createHeaderIdentityProvider(config);
    case "passkey":
      return createPasskeyIdentityProvider(config, deps);
  }
};
