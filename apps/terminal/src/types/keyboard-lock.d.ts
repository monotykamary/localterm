// Minimal shape of the Chromium Keyboard Lock API (www.w3.org/TR/keyboard-lock).
// Not yet in TypeScript's DOM lib; lands here so the takeover hook can call it
// type-safely. Global augmentation — no import/export on purpose.
interface KeyboardLockManager {
  lock: (keyCodes?: string[]) => Promise<void>;
  unlock: () => void;
}

interface Navigator {
  readonly keyboard?: KeyboardLockManager;
}
