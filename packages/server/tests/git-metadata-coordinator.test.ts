import { describe, expect, it } from "vite-plus/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GitMetadataCoordinator } from "../src/git-metadata-coordinator.js";
import type { ClientSocket } from "../src/utils/ws-socket.js";
import type { GitBranchPr, ServerToClientMessage } from "../src/types.js";

const fakeSocket = (): ClientSocket => ({ readyState: 1, send: () => {}, close: () => {} });

const mergedPr: GitBranchPr = {
  number: 42,
  title: "Fix",
  baseRefName: "main",
  baseRef: "origin/main",
  url: "https://github.com/o/r/pull/42",
  state: "merged",
  isDraft: false,
  mergeable: "mergeable",
  mergedAt: "2024-01-01T00:00:00.000Z",
};

type SentEntry = { ws: ClientSocket; payload: ServerToClientMessage };

describe("GitMetadataCoordinator broadcastPr", () => {
  // A fresh non-repo dir so add()'s ambient summary compute is a no-op (empty
  // summary) and the test isolates broadcastPr from the git-dirty path.
  const mkDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "lt-coord-"));

  it("pushes the refreshed PR to every subscribed tab, never to others", () => {
    const dir = mkDir();
    try {
      const sent: SentEntry[] = [];
      const coordinator = new GitMetadataCoordinator(dir, (ws, payload) =>
        sent.push({ ws, payload }),
      );
      const tabA = fakeSocket();
      const tabB = fakeSocket();
      coordinator.add(tabA);
      coordinator.add(tabB);

      coordinator.broadcastPr(mergedPr);

      // Only broadcastPr emits git-branch-pr (add's ambient run emits
      // git-diff-summary), so filtering isolates it without awaiting git.
      const pushes = sent.filter((entry) => entry.payload.type === "git-branch-pr");
      expect(pushes).toHaveLength(2);
      expect(new Set(pushes.map((entry) => entry.ws))).toEqual(new Set([tabA, tabB]));
      for (const { payload } of pushes) {
        if (payload.type === "git-branch-pr") expect(payload.pr).toEqual(mergedPr);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not replay the PR on subscribe (a stale cached value must not race a tab's own fetch)", () => {
    const dir = mkDir();
    try {
      const sent: SentEntry[] = [];
      const coordinator = new GitMetadataCoordinator(dir, (ws, payload) =>
        sent.push({ ws, payload }),
      );
      const tabA = fakeSocket();
      coordinator.add(tabA);
      coordinator.broadcastPr(mergedPr);

      const tabB = fakeSocket();
      coordinator.add(tabB);

      const prReplays = sent.filter(
        (entry) => entry.ws === tabB && entry.payload.type === "git-branch-pr",
      );
      expect(prReplays).toHaveLength(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
