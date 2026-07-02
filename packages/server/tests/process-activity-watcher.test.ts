import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ProcessActivityWatcher } from "../src/process-activity-watcher.js";
import { buildShimContent, regenerateShims } from "../src/secret-shims.js";
import type { Process } from "../src/types.js";
import type { SecretBackend } from "../src/secret-backend.js";

const DEBOUNCE_MS = 50;

// A fake watch factory: records the listener armed for each target so a test
// can fire synthetic filesystem events, and tracks close(). With fake timers
// this makes every behavior deterministic — no real fs or wall-clock timing.
const makeFakeWatch = () => {
  const armed = new Map<string, { listener: (event: string, filename: string | null) => void }>();
  const watch = (
    target: string,
    _options: { recursive: boolean },
    listener: (event: string, filename: string | null) => void,
  ): { close: () => void } => {
    const record = { listener };
    armed.set(target, record);
    return {
      close: () => {
        if (armed.get(target) === record) armed.delete(target);
      },
    };
  };
  return {
    watch,
    armed,
    fire: (target: string, filename: string | null = null) =>
      armed.get(target)?.listener("change", filename),
  };
};

// In-memory backend so tests never touch the real Keychain.
class FakeBackend implements SecretBackend {
  readonly supported = true;
  readonly store = new Map<string, string>();
  async get(name: string) {
    return this.store.get(name) ?? null;
  }
  async has(name: string) {
    return this.store.has(name);
  }
  async set(name: string, value: string) {
    this.store.set(name, value);
  }
  async delete(name: string) {
    this.store.delete(name);
  }
  shimResolveSnippet(name: string, envVar: string): string {
    return `_fake_resolve '${name}' ${envVar}`;
  }
}

class UnsupportedBackend implements SecretBackend {
  readonly supported = false;
  async get(): Promise<string | null> {
    return null;
  }
  async has(): Promise<boolean> {
    return false;
  }
  async set(): Promise<void> {}
  async delete(): Promise<void> {}
  shimResolveSnippet(): string {
    return ":";
  }
}

describe("ProcessActivityWatcher", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = (programs = ["gh"]) => {
    const activityDir = "/virtual/activity";
    const cwdForFile = new Map<string, string>();
    const fake = makeFakeWatch();
    const watcher = new ProcessActivityWatcher({
      activityDir,
      programs,
      debounceMs: DEBOUNCE_MS,
      watch: fake.watch,
      readCwd: (file) => cwdForFile.get(file) ?? null,
    });
    const events: Array<{ program: string; cwd: string }> = [];
    watcher.on("activity", (program, cwd) => events.push({ program, cwd }));
    return {
      watcher,
      events,
      fire: (filename: string, cwd: string) => {
        cwdForFile.set(path.join(activityDir, filename), cwd);
        fake.fire(activityDir, filename);
      },
      fireBare: (filename: string | null) => fake.fire(activityDir, filename),
    };
  };

  it("emits an activity event with the program and its cwd after the debounce", () => {
    const { watcher, events, fire } = setup();
    fire("gh", "/repo");
    expect(events).toEqual([]);
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(events).toEqual([{ program: "gh", cwd: "/repo" }]);
    watcher.dispose();
  });

  it("coalesces a burst for one cwd into a single emission", () => {
    const { watcher, events, fire } = setup();
    fire("gh", "/repo");
    fire("gh", "/repo");
    fire("gh", "/repo");
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(events).toEqual([{ program: "gh", cwd: "/repo" }]);
    watcher.dispose();
  });

  it("debounces per cwd so concurrent signals in different dirs both fire", () => {
    const { watcher, events, fire } = setup();
    fire("gh", "/repo-a");
    fire("gh", "/repo-b");
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(events).toEqual([
      { program: "gh", cwd: "/repo-a" },
      { program: "gh", cwd: "/repo-b" },
    ]);
    watcher.dispose();
  });

  it("ignores writes for programs not in the watched set", () => {
    const { watcher, events, fire, fireBare } = setup(["gh"]);
    fire("other", "/repo");
    fireBare(null);
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(events).toEqual([]);
    watcher.dispose();
  });

  it("drops an event whose activity file is unreadable", () => {
    const { watcher, events, fireBare } = setup();
    fireBare("gh"); // no cwd staged under readCwd -> readCwd returns null
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(events).toEqual([]);
    watcher.dispose();
  });

  it("does not emit after dispose", () => {
    const { watcher, events, fire } = setup();
    fire("gh", "/repo");
    watcher.dispose();
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(events).toEqual([]);
  });
});

describe("activity shim generation", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "localterm-activity-shim-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("emits the fork-wait + signal variant for an activity-watched program", () => {
    const shimsDir = path.join(tmp, "shims");
    const activityDir = path.join(tmp, "activity");
    const content = buildShimContent("gh", shimsDir, "", path.join(activityDir, "gh"));
    expect(content).toContain("_activity_file=");
    expect(content).toContain(activityDir);
    expect(content).toContain('"$_real" "$@"');
    expect(content).toContain("_rc=$?");
    expect(content).toContain('printf \'%s\\n\' "$PWD" > "$_activity_file" 2>/dev/null || :');
    expect(content).toContain("exit $_rc");
    expect(content).not.toContain('exec "$_real" "$@"');
  });

  it("keeps exec (no activity signal) for a non-activity-watched program", () => {
    const shimsDir = path.join(tmp, "shims");
    const content = buildShimContent("pi", shimsDir, "_resolve ANTHROPIC_API_KEY");
    expect(content).toContain('exec "$_real" "$@"');
    expect(content).not.toContain("_activity_file=");
    expect(content).not.toContain("exit $_rc");
  });

  it("merges secret resolution with the activity signal when a watched program has secrets", () => {
    const shimsDir = path.join(tmp, "shims");
    const activityDir = path.join(tmp, "activity");
    const content = buildShimContent(
      "gh",
      shimsDir,
      "_resolve GH_TOKEN",
      path.join(activityDir, "gh"),
    );
    expect(content).toContain("_resolve GH_TOKEN");
    expect(content).toContain('"$_real" "$@"');
    expect(content).toContain("exit $_rc");
  });

  it("generates a gh activity shim even with no user-configured processes", () => {
    const shimsDir = path.join(tmp, "shims");
    const activityDir = path.join(tmp, "activity");
    regenerateShims([], new Map(), shimsDir, new FakeBackend(), activityDir, ["gh"]);
    const ghShim = path.join(shimsDir, "gh");
    expect(existsSync(ghShim)).toBe(true);
    const content = readFileSync(ghShim, "utf8");
    expect(content).toContain("_activity_file=");
    expect(content).toContain("exit $_rc");
  });

  it("does not generate an activity shim when the backend is unsupported", () => {
    const shimsDir = path.join(tmp, "shims");
    const activityDir = path.join(tmp, "activity");
    const unsupported: SecretBackend = new UnsupportedBackend();
    regenerateShims([], new Map(), shimsDir, unsupported, activityDir, ["gh"]);
    expect(existsSync(path.join(shimsDir, "gh"))).toBe(false);
  });

  it("sweeps a stale non-watched shim but keeps the watched one", () => {
    const shimsDir = path.join(tmp, "shims");
    const activityDir = path.join(tmp, "activity");
    const backend = new FakeBackend();
    const pi: Process = { name: "pi", requestedSecrets: [] };
    // First pass: only pi exists (but pi has no secrets and isn't watched -> no
    // shim). We force a pi shim by giving it a secret, then drop the secret.
    regenerateShims(
      [{ name: "pi", requestedSecrets: ["k"] }],
      new Map([["k", "K"]]),
      shimsDir,
      backend,
      activityDir,
      ["gh"],
    );
    expect(existsSync(path.join(shimsDir, "pi"))).toBe(true);
    expect(existsSync(path.join(shimsDir, "gh"))).toBe(true);
    // Second pass: pi no longer requests the secret -> swept; gh stays.
    regenerateShims([pi], new Map([["k", "K"]]), shimsDir, backend, activityDir, ["gh"]);
    expect(existsSync(path.join(shimsDir, "pi"))).toBe(false);
    expect(existsSync(path.join(shimsDir, "gh"))).toBe(true);
    expect(readFileSync(path.join(shimsDir, "gh"), "utf8")).toContain("_activity_file=");
  });
});
