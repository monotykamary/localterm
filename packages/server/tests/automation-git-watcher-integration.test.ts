import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { AutomationGitWatcher } from "../src/automation-git-watcher.js";
import type { GitRefEventName } from "../src/git-diff-watcher.js";
import type { Automation } from "../src/types.js";

// Real fs.watch + real git (no injection, real timers) — the end-to-end path a
// unit test can't cover: a non-localterm process committing in a watched tree,
// observed by the daemon-global watcher exactly as the daemon runs it.

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const waitFor = async (
  predicate: () => boolean,
  { timeoutMs = 4_000, intervalMs = 25 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start >= timeoutMs) throw new Error("waitFor timed out");
    await wait(intervalMs);
  }
};

const runGit = (cwd: string, args: string[]): void => {
  try {
    execFileSync("git", args, { cwd, stdio: "pipe" });
  } catch (error) {
    const stderr = error instanceof Error && "stderr" in error ? String(error.stderr) : "";
    throw new Error(
      `git ${args.join(" ")} (cwd ${cwd}) failed: ${stderr || (error as Error).message}`,
    );
  }
};

const GIT_IDENTITY = [
  "-c",
  "user.email=test@localterm",
  "-c",
  "user.name=test",
  "-c",
  "commit.gpgsign=false",
];

describe("AutomationGitWatcher (real fs.watch + real git)", { tags: ["integration"] }, () => {
  const trash: string[] = [];
  let watcher: AutomationGitWatcher | null = null;
  const emitted: Array<[GitRefEventName, string]> = [];

  afterEach(() => {
    watcher?.dispose();
    watcher = null;
    emitted.length = 0;
    for (const dir of trash) fs.rmSync(dir, { recursive: true, force: true });
    trash.length = 0;
  });

  const mkContainer = (): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "localterm-agw-it-"));
    trash.push(dir);
    return dir;
  };

  const arm = (cwd: string): void => {
    watcher = new AutomationGitWatcher({ throttleMs: 100 });
    watcher.on("refEvent", (eventName, repoRoot) => emitted.push([eventName, repoRoot]));
    const automation = {
      id: "a1",
      name: "git watcher",
      trigger: { kind: "event" as const, events: ["git-commit", "git-branch-change"] },
      cwd,
      runner: { kind: "shell" as const, command: "true" },
      enabled: true,
      limit: { kind: "forever" as const },
      closeOnFinish: false,
      requestedSecrets: [],
      runCount: 0,
      lifecycle: "active" as const,
      runs: [],
      createdAt: 0,
      updatedAt: 0,
    } satisfies Automation;
    watcher.sync([automation]);
  };

  const initRepo = (repo: string): void => {
    fs.mkdirSync(repo, { recursive: true });
    runGit(repo, ["init", "-q"]);
  };

  const commit = (repo: string, message: string): void => {
    runGit(repo, [...GIT_IDENTITY, "commit", "--allow-empty", "-q", "-m", message]);
  };

  it("detects a new repo's first commit when init and commit are separate commands", async () => {
    const container = mkContainer();
    arm(container);
    await wait(150); // let the recursive watch register

    // A non-localterm process (a child git invocation) creates a repo and
    // commits — the exact scenario the per-session watcher misses.
    const repo = path.join(container, "newrepo");
    initRepo(repo);
    await wait(250); // separate fs.watch batch: discovery seeds the empty tree
    commit(repo, "first");

    await waitFor(() =>
      emitted.some(([event, root]) => event === "git-branch-change" && root === repo),
    );
    expect(emitted.some(([event, root]) => event === "git-branch-change" && root === repo)).toBe(
      true,
    );
  }, 15_000);

  it("detects a new repo's first commit when init and commit are one back-to-back command", async () => {
    const container = mkContainer();
    arm(container);
    await wait(150); // let the recursive watch register

    const repo = path.join(container, "batched");
    // init + first commit in a single shell command — the case most likely to
    // arrive as one FSEvents batch (no gap for the watcher to seed the empty
    // tree first). The discovery-emit still surfaces the appeared branch ref.
    execFileSync(
      "sh",
      [
        "-c",
        `git init -q ${JSON.stringify(repo)} && git ${GIT_IDENTITY.join(" ")} -C ${JSON.stringify(repo)} commit --allow-empty -q -m first`,
      ],
      { stdio: "pipe" },
    );

    await waitFor(() =>
      emitted.some(([event, root]) => event === "git-branch-change" && root === repo),
    );
    expect(emitted.some(([event, root]) => event === "git-branch-change" && root === repo)).toBe(
      true,
    );
  }, 15_000);

  it("detects a subsequent commit on an existing branch as git-commit", async () => {
    const container = mkContainer();
    const repo = path.join(container, "repoA");
    initRepo(repo);
    commit(repo, "first");
    arm(container);
    await wait(150);

    commit(repo, "second");
    await waitFor(() => emitted.some(([event, root]) => event === "git-commit" && root === repo));
    expect(emitted.some(([event, root]) => event === "git-commit" && root === repo)).toBe(true);
  }, 15_000);

  it("ignores a non-.git file change under the watched tree", async () => {
    const container = mkContainer();
    const repo = path.join(container, "repoA");
    initRepo(repo);
    commit(repo, "first");
    arm(container);
    await wait(250); // let any init/commit events settle

    const before = emitted.length;
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.writeFileSync(path.join(repo, "src", "index.ts"), "export {};\n");
    await wait(600); // past the throttle window
    expect(emitted.length).toBe(before);
  }, 15_000);

  it("routes concurrent commits in sibling repos to the right repoRoot", async () => {
    const container = mkContainer();
    const repoA = path.join(container, "repoA");
    const repoB = path.join(container, "repoB");
    initRepo(repoA);
    initRepo(repoB);
    commit(repoA, "a1");
    commit(repoB, "b1");
    arm(container);
    await wait(150);

    commit(repoA, "a2");
    commit(repoB, "b2");
    await waitFor(() => emitted.some(([event, root]) => event === "git-commit" && root === repoA));
    await waitFor(() => emitted.some(([event, root]) => event === "git-commit" && root === repoB));
    expect(emitted.some(([event, root]) => event === "git-commit" && root === repoA)).toBe(true);
    expect(emitted.some(([event, root]) => event === "git-commit" && root === repoB)).toBe(true);
  }, 15_000);
});
