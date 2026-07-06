import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { AutomationGitWatcher } from "../src/automation-git-watcher.js";
import type { Automation } from "../src/types.js";
import type { GitRefEventName } from "../src/git-diff-watcher.js";

const THROTTLE_MS = 50;

const sha = (index: number): string => String(index).padStart(40, "0");

// A repo with one commit on `main` (refs/heads/main = sha1, HEAD → main).
const createRepo = (root: string): void => {
  const gitDir = path.join(root, ".git");
  fs.mkdirSync(path.join(gitDir, "refs", "heads"), { recursive: true });
  fs.mkdirSync(path.join(gitDir, "refs", "tags"), { recursive: true });
  fs.writeFileSync(path.join(gitDir, "HEAD"), "ref: refs/heads/main\n");
  fs.writeFileSync(path.join(gitDir, "refs", "heads", "main"), `${sha(1)}\n`);
};

// A freshly `git init`-ed repo: HEAD points at main, but main has no commits yet
// (refs/heads/main does not exist).
const initRepo = (root: string): void => {
  const gitDir = path.join(root, ".git");
  fs.mkdirSync(path.join(gitDir, "refs", "heads"), { recursive: true });
  fs.writeFileSync(path.join(gitDir, "HEAD"), "ref: refs/heads/main\n");
};

const mainRef = (root: string): string => path.join(root, ".git", "refs", "heads", "main");

const makeAutomation = (overrides: Partial<Automation> = {}): Automation => ({
  id: "a1",
  name: "git watcher",
  trigger: { kind: "event", events: ["git-commit"] },
  cwd: "/virtual/container",
  runner: { kind: "shell", command: "true" },
  enabled: true,
  limit: { kind: "forever" },
  closeOnFinish: false,
  requestedSecrets: [],
  runCount: 0,
  lifecycle: "active",
  runs: [],
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
});

const makeFakeWatch = () => {
  const armed = new Map<string, (event: string, filename: string | null) => void>();
  const watch = (
    target: string,
    _options: { recursive: boolean },
    listener: (event: string, filename: string | null) => void,
  ): { close: () => void } => {
    armed.set(target, listener);
    return {
      close: () => {
        armed.delete(target);
      },
    };
  };
  return {
    watch,
    armed,
    fire: (target: string, filename: string | null = null) =>
      armed.get(target)?.("change", filename),
  };
};

describe("AutomationGitWatcher", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const trash: string[] = [];
  afterEach(() => {
    for (const dir of trash) fs.rmSync(dir, { recursive: true, force: true });
    trash.length = 0;
  });

  const setup = () => {
    const fake = makeFakeWatch();
    const watcher = new AutomationGitWatcher({ throttleMs: THROTTLE_MS, watch: fake.watch });
    const emitted: Array<[GitRefEventName, string]> = [];
    watcher.on("refEvent", (eventName, repoRoot) => emitted.push([eventName, repoRoot]));
    return { watcher, emitted, fire: fake.fire, armed: fake.armed };
  };

  const mkContainer = (): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "localterm-agw-"));
    trash.push(dir);
    return dir;
  };

  // Discover a repo by firing a benign `.git` event (no state change) so the
  // snapshot is seeded from the pre-change tree, then idle the throttle. This
  // mirrors a repo that existed before the watch armed.
  const discover = (
    fire: (target: string, filename: string | null) => void,
    container: string,
    repoRelHead: string,
  ) => {
    fire(container, repoRelHead);
    vi.advanceTimersByTime(THROTTLE_MS);
  };

  it("classifies a subsequent commit on an existing repo as git-commit", () => {
    const container = mkContainer();
    const repo = path.join(container, "repoA");
    createRepo(repo);
    const { watcher, emitted, fire, armed } = setup();

    watcher.sync([makeAutomation({ cwd: container })]);
    expect(armed.has(container)).toBe(true);

    discover(fire, container, "repoA/.git/HEAD");
    expect(emitted).toHaveLength(0);

    fs.writeFileSync(mainRef(repo), `${sha(2)}\n`);
    fire(container, "repoA/.git/refs/heads/main");
    // Leading edge of an idle throttle classifies synchronously.
    expect(emitted).toContainEqual(["git-commit", repo]);
    expect(emitted).toContainEqual(["git-branch-change", repo]);
    watcher.dispose();
  });

  it("discovers a repo created after the watch armed and classifies its first commit", () => {
    const container = mkContainer();
    const { watcher, emitted, fire } = setup();
    watcher.sync([makeAutomation({ cwd: container })]);

    // `git init` after the watch started: the recursive watch sees the new .git.
    const repo = path.join(container, "newrepo");
    initRepo(repo);
    discover(fire, container, "newrepo/.git/HEAD");
    expect(emitted).toHaveLength(0);

    // First commit on a brand-new branch creates refs/heads/main — classified
    // as git-branch-change, NOT git-commit (creating a ref is not advancing one).
    fs.writeFileSync(mainRef(repo), `${sha(1)}\n`);
    fire(container, "newrepo/.git/refs/heads/main");
    expect(emitted).toContainEqual(["git-branch-change", repo]);
    expect(emitted).not.toContainEqual(["git-commit", repo]);

    // A subsequent commit advances the existing ref → git-commit.
    vi.advanceTimersByTime(THROTTLE_MS);
    fs.writeFileSync(mainRef(repo), `${sha(2)}\n`);
    fire(container, "newrepo/.git/refs/heads/main");
    expect(emitted).toContainEqual(["git-commit", repo]);
    watcher.dispose();
  });

  it("emits git-branch-change when a new repo appears with a commit in a single batch", () => {
    const container = mkContainer();
    const { watcher, emitted, fire } = setup();
    // Eager walk at arm finds nothing — the repo doesn't exist yet.
    watcher.sync([makeAutomation({ cwd: container })]);

    // `git init` + first commit land before any fs event reaches the watcher
    // (e.g. one FSEvents batch): the repo is non-empty the instant it's seen.
    const repo = path.join(container, "newrepo");
    initRepo(repo);
    fs.writeFileSync(mainRef(repo), `${sha(1)}\n`);
    fire(container, "newrepo/.git/refs/heads/main");
    // No pre-state to diff → emit the refs that appeared against the empty tree.
    expect(emitted).toContainEqual(["git-branch-change", repo]);
    expect(emitted).not.toContainEqual(["git-commit", repo]);
    watcher.dispose();
  });

  it("ignores events outside a repo's .git", () => {
    const container = mkContainer();
    const repo = path.join(container, "repoA");
    createRepo(repo);
    const { watcher, emitted, fire } = setup();
    watcher.sync([makeAutomation({ cwd: container })]);
    discover(fire, container, "repoA/.git/HEAD");

    fire(container, "repoA/src/index.ts");
    fire(container, "repoA/.gitignore");
    fire(container, "repoA/node_modules/pkg/index.js");
    vi.advanceTimersByTime(THROTTLE_MS);
    expect(emitted).toHaveLength(0);
    watcher.dispose();
  });

  it("ignores events with a null filename instead of crashing", () => {
    const container = mkContainer();
    const repo = path.join(container, "repoA");
    createRepo(repo);
    const { watcher, emitted, fire } = setup();
    watcher.sync([makeAutomation({ cwd: container })]);
    discover(fire, container, "repoA/.git/HEAD");

    fire(container, null);
    vi.advanceTimersByTime(THROTTLE_MS);
    expect(emitted).toHaveLength(0);
    watcher.dispose();
  });

  it("ignores a repo under node_modules (a dependency clone, not a project)", () => {
    const container = mkContainer();
    const dep = path.join(container, "repoA", "node_modules", "some-dep");
    createRepo(dep);
    const { watcher, emitted, fire, armed } = setup();
    watcher.sync([makeAutomation({ cwd: container })]);
    expect(armed.has(container)).toBe(true);

    discover(fire, container, "repoA/node_modules/some-dep/.git/HEAD");
    fs.writeFileSync(mainRef(dep), `${sha(2)}\n`);
    fire(container, "repoA/node_modules/some-dep/.git/refs/heads/main");
    vi.advanceTimersByTime(THROTTLE_MS);
    expect(emitted).toHaveLength(0);
    watcher.dispose();
  });

  it("routes concurrent commits in sibling repos to the right repoRoot", () => {
    const container = mkContainer();
    const repoA = path.join(container, "repoA");
    const repoB = path.join(container, "repoB");
    createRepo(repoA);
    createRepo(repoB);
    const { watcher, emitted, fire } = setup();
    watcher.sync([makeAutomation({ cwd: container })]);
    discover(fire, container, "repoA/.git/HEAD");
    discover(fire, container, "repoB/.git/HEAD");

    fs.writeFileSync(mainRef(repoA), `${sha(2)}\n`);
    fire(container, "repoA/.git/refs/heads/main");
    fs.writeFileSync(mainRef(repoB), `${sha(9)}\n`);
    fire(container, "repoB/.git/refs/heads/main");

    expect(emitted).toContainEqual(["git-commit", repoA]);
    expect(emitted).toContainEqual(["git-commit", repoB]);
    watcher.dispose();
  });

  it("arms a watcher only for event automations that select a git event", () => {
    const container = mkContainer();
    const { watcher, armed } = setup();

    watcher.sync([
      makeAutomation({ cwd: container, trigger: { kind: "event", events: ["notification"] } }),
    ]);
    expect(armed.has(container)).toBe(false);

    watcher.sync([
      makeAutomation({ cwd: container, trigger: { kind: "event", events: ["git-merge"] } }),
    ]);
    expect(armed.has(container)).toBe(true);

    watcher.sync([
      makeAutomation({
        cwd: container,
        trigger: { kind: "event", events: ["git-commit", "notification"] },
      }),
    ]);
    expect(armed.has(container)).toBe(true);
    watcher.dispose();
  });

  it("stops the watcher when its automation leaves the desired set", () => {
    const container = mkContainer();
    const { watcher, armed } = setup();
    const automation = makeAutomation({ cwd: container });

    watcher.sync([automation]);
    expect(armed.has(container)).toBe(true);

    watcher.sync([{ ...automation, enabled: false }]);
    expect(armed.has(container)).toBe(false);

    watcher.sync([automation]);
    expect(armed.has(container)).toBe(true);
    watcher.dispose();
  });

  it("watches each distinct cwd once across automations that share it", () => {
    const container = mkContainer();
    const { watcher, armed } = setup();

    watcher.sync([
      makeAutomation({ id: "a1", cwd: container }),
      makeAutomation({ id: "a2", cwd: container }),
    ]);
    expect(armed.size).toBe(1);
    expect(armed.has(container)).toBe(true);

    watcher.sync([makeAutomation({ id: "a1", cwd: container })]);
    expect(armed.has(container)).toBe(true);
    watcher.dispose();
  });
});
