import { AuthGate } from "@/components/auth-gate";
import { Terminal } from "@/components/terminal";

export const App = () => (
  <AuthGate>
    <Terminal />
  </AuthGate>
);
