import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/browser";
import { Fingerprint, LogIn, UserPlus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  authSessionSchema,
  identityProviderInfoSchema,
  type AuthSession,
  type IdentityProviderInfo,
} from "@monotykamary/localterm-server/protocol";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

const apiUrl = (path: string): string => new URL(path, window.location.href).toString();

const postJson = async (path: string, body: unknown): Promise<Response> =>
  fetch(apiUrl(path), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

// No provider (legacy single-authority) or an external proxy owns the login
// (`header`) → there's no in-app flow, so the gate is transparent. Only
// `passkey`/`oidc` run their own login and can hold the terminal back. Inlined
// in `check` (rather than a helper) so TypeScript narrows `provider` to the
// flow-bearing variants after the guard.

type GateState =
  | { status: "loading" }
  | { status: "ready" }
  | {
      status: "login";
      provider: "passkey" | "oidc";
      registration: IdentityProviderInfo["registration"];
      webAuthnSupported: boolean;
    };

export const AuthGate = ({ children }: { children: ReactNode }) => {
  const [state, setState] = useState<GateState>({ status: "loading" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [username, setUsername] = useState("");

  // Probe the configured flow and the current session. A flowless provider or a
  // valid session renders the terminal; otherwise we show the login screen the
  // provider dictates. A failed probe (daemon unreachable mid-load) falls
  // through to the terminal so the existing connection UI surfaces the real
  // error instead of a stuck login screen.
  const check = useCallback(async () => {
    try {
      const infoRes = await fetch(apiUrl("/auth/provider"));
      const info: IdentityProviderInfo = identityProviderInfoSchema.parse(await infoRes.json());
      const { provider } = info;
      if (provider === null || provider === "header") {
        setState({ status: "ready" });
        return;
      }
      const meRes = await fetch(apiUrl(`/auth/${provider}/me`));
      const me: AuthSession = authSessionSchema.parse(await meRes.json());
      if (me.user) {
        setState({ status: "ready" });
        return;
      }
      setState({
        status: "login",
        provider,
        registration: info.registration,
        webAuthnSupported: browserSupportsWebAuthn(),
      });
    } catch {
      setState({ status: "ready" });
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  const finish = useCallback(async () => {
    setBusy(false);
    await check();
  }, [check]);

  const register = useCallback(async () => {
    const trimmed = username.trim();
    if (!trimmed) {
      setError("Enter a username for the passkey.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const optionsRes = await postJson("/auth/passkey/register/options", { username: trimmed });
      const options = await optionsRes.json();
      const response: RegistrationResponseJSON = await startRegistration({ optionsJSON: options });
      const verifyRes = await postJson("/auth/passkey/register/verify", {
        username: trimmed,
        response,
      });
      if (!verifyRes.ok) {
        setError("Registration failed — the passkey may already be registered.");
        setBusy(false);
        return;
      }
      await finish();
    } catch {
      setError("Registration cancelled or not supported by this browser.");
      setBusy(false);
    }
  }, [username, finish]);

  const signInPasskey = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const trimmed = username.trim();
      const optionsRes = await postJson(
        "/auth/passkey/login/options",
        trimmed ? { username: trimmed } : {},
      );
      const options = await optionsRes.json();
      const response: AuthenticationResponseJSON = await startAuthentication({
        optionsJSON: options,
      });
      const verifyRes = await postJson("/auth/passkey/login/verify", { response });
      if (!verifyRes.ok) {
        setError("Sign-in failed — register a passkey first.");
        setBusy(false);
        return;
      }
      await finish();
    } catch {
      setError("Sign-in cancelled or not supported by this browser.");
      setBusy(false);
    }
  }, [username, finish]);

  const signInOidc = useCallback(() => {
    const returnTo = window.location.pathname + window.location.search;
    window.location.href = apiUrl(`/auth/oidc/login?returnTo=${encodeURIComponent(returnTo)}`);
  }, []);

  if (state.status === "loading") {
    return (
      <div className="flex h-dvh items-center justify-center bg-background text-foreground">
        <Spinner />
      </div>
    );
  }

  if (state.status === "ready") return <>{children}</>;

  const isPasskey = state.provider === "passkey";
  const registrationOpen = state.registration !== "closed";

  return (
    <div className="flex h-dvh items-center justify-center bg-background px-4 text-foreground">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1.5 text-center">
          <div className="flex items-center justify-center gap-2 text-lg font-semibold">
            <Fingerprint className="size-5" />
            <span>localterm</span>
          </div>
          <p className="text-sm text-muted-foreground">Sign in to access the terminal.</p>
        </div>

        {isPasskey ? (
          state.webAuthnSupported ? (
            <div className="space-y-3">
              <Input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="username"
                autoComplete="username webauthn"
                onKeyDown={(event) => {
                  if (event.key === "Enter" && registrationOpen) void register();
                }}
              />
              {registrationOpen && (
                <Button className="w-full" onClick={() => void register()} disabled={busy}>
                  <UserPlus />
                  Register a passkey
                </Button>
              )}
              <Button
                className="w-full"
                variant="outline"
                onClick={() => void signInPasskey()}
                disabled={busy}
              >
                <Fingerprint />
                Sign in with passkey
              </Button>
            </div>
          ) : (
            <p className="text-center text-sm text-muted-foreground">
              This browser doesn&rsquo;t support passkeys. Use a browser with WebAuthn, or switch
              the daemon to an identity-provider (OIDC) or proxy-header flow.
            </p>
          )
        ) : (
          <Button className="w-full" onClick={signInOidc} disabled={busy}>
            <LogIn />
            Sign in with your identity provider
          </Button>
        )}

        {error && <p className="text-center text-sm text-destructive">{error}</p>}
      </div>
    </div>
  );
};
