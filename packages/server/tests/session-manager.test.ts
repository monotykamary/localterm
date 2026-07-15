import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SessionManager } from "../src/session-manager.js";
import type { ClientSocket } from "../src/utils/ws-socket.js";
import type { ServerToClientMessage } from "../src/types.js";
import { pollFor } from "./helpers/poll-for.js";

const createFakeSocket = (): ClientSocket => ({
  readyState: 1,
  send: () => {},
  close: () => {},
});

const createManager = (graceMs: number): SessionManager =>
  new SessionManager({
    getGraceMs: () => graceMs,
    sendControl: () => {},
    hooks: {
      onOutputActivity: () => {},
      onSessionActivity: () => {},
      onSessionEvent: () => {},
      onAutomationExit: () => {},
      onClientExit: () => {},
    },
  });

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const shellInput = { shell: "/bin/sh", cwd: os.tmpdir() };

describe("SessionManager no-clients grace", { tags: ["integration"] }, () => {
  let manager: SessionManager;

  afterEach(() => {
    manager?.disposeAll();
  });

  it("reaps an idle PTY whose last subscriber detaches and doesn't re-attach in time", async () => {
    manager = createManager(50);
    const ws = createFakeSocket();
    const spawned = manager.spawnAndAttach(ws, shellInput);
    expect(spawned).not.toBeNull();
    if (!spawned) return;
    // A real /bin/sh keeps emitting its prompt, which would reschedule the
    // grace forever; force idle so the reap is eligible.
    manager.markIdleForTest(spawned.id);
    expect(manager.size()).toBe(1);
    expect(manager.list()[0]?.clients).toBe(1);

    manager.detach(ws);
    // Detached → grace armed, but the PTY is still live (parked) for the window.
    expect(manager.size()).toBe(1);
    expect(manager.list()[0]?.clients).toBe(0);

    // Grace elapsed with no re-attach → reaped. No zombie.
    expect(await pollFor(() => manager.size() === 0)).toBe(true);
    expect(spawned.session.isExited).toBe(true);
  }, 10_000);

  it("cancels the grace when a subscriber re-attaches within the window", async () => {
    manager = createManager(50);
    const ws = createFakeSocket();
    const spawned = manager.spawnAndAttach(ws, shellInput);
    expect(spawned).not.toBeNull();
    if (!spawned) return;
    const sid = spawned.id;

    manager.detach(ws);
    expect(manager.size()).toBe(1);

    // A second tab joins alongside before the grace fires.
    const joining = createFakeSocket();
    const reattached = manager.attach(joining, sid);
    expect(reattached).not.toBeNull();
    expect(manager.list()[0]?.clients).toBe(1);

    await wait(150);
    // The re-attach cancelled the grace, so the PTY survived the window.
    expect(manager.size()).toBe(1);
    expect(spawned.session.isExited).toBe(false);

    // Now the joining tab leaves too; a fresh grace starts. Mark idle so the
    // real shell's prompt output doesn't reschedule the reap.
    manager.detach(joining);
    manager.markIdleForTest(sid);
    expect(await pollFor(() => manager.size() === 0)).toBe(true);
    expect(spawned.session.isExited).toBe(true);
  }, 10_000);

  it("groups attached clients by window id in clientProfiles", () => {
    manager = createManager(50);
    const wsA = createFakeSocket();
    const wsB = createFakeSocket();
    const wsC = createFakeSocket();
    const spawned = manager.spawnAndAttach(wsA, shellInput, undefined, null, "profile-a");
    expect(spawned).not.toBeNull();
    if (!spawned) return;
    const sid = spawned.id;
    // A second tab of the same browser profile joins, plus one of another.
    manager.attach(wsB, sid, null, "profile-a");
    manager.attach(wsC, sid, null, "profile-b");
    const item = manager.list()[0];
    expect(item?.clients).toBe(3);
    expect(item?.clientProfiles).toEqual([
      { windowId: "profile-a", count: 2 },
      { windowId: "profile-b", count: 1 },
    ]);
    manager.detach(wsA);
    manager.detach(wsB);
    manager.detach(wsC);
  });

  it("keeps a dormant PTY alive while it's still producing output", async () => {
    manager = createManager(40);
    const ws = createFakeSocket();
    const spawned = manager.spawnAndAttach(ws, shellInput);
    expect(spawned).not.toBeNull();
    if (!spawned) return;
    manager.detach(ws);
    // The shell keeps producing — keep refreshing lastOutputAt within the
    // activity window across several grace intervals.
    for (let tick = 0; tick < 5; tick++) {
      await wait(20);
      manager.noteOutput(spawned.session.pid);
    }
    await wait(10);
    expect(manager.size()).toBe(1);
    expect(spawned.session.isExited).toBe(false);
    // Output goes quiet → the next grace fires and reaps.
    manager.markIdleForTest(spawned.id);
    expect(await pollFor(() => manager.size() === 0)).toBe(true);
    expect(spawned.session.isExited).toBe(true);
  }, 10_000);

  it("keeps a dormant PTY alive while a foreground program runs quietly (alive-quiet)", async () => {
    manager = createManager(50);
    const ws = createFakeSocket();
    const spawned = manager.spawnAndAttach(ws, shellInput);
    expect(spawned).not.toBeNull();
    if (!spawned) return;
    manager.detach(ws);

    // Output has gone quiet but a foreground program is still running — the
    // favicon would be blue (alive-quiet), not grey. The grace reap must spare
    // it so a closed tab never kills a quiet-but-running command.
    manager.markIdleForTest(spawned.id);
    manager.markForegroundForTest(spawned.id);
    await wait(150);
    expect(manager.size()).toBe(1);
    expect(spawned.session.isExited).toBe(false);

    // Foreground program exits → only output idleness is left (ready) → reaped.
    manager.markForegroundForTest(spawned.id, false);
    expect(await pollFor(() => manager.size() === 0)).toBe(true);
    expect(spawned.session.isExited).toBe(true);
  }, 10_000);

  it("reaps an idle /bin/sh — an unhooked shell reports no foreground", async () => {
    // /bin/sh is not in HOOKED_SHELL_NAMES, so it gets no preexec/precmd hook
    // and never reports a foreground program. An idle /bin/sh therefore reads
    // "ready" and reaps. (This replaces the old pty.process alias check: on
    // macOS /bin/sh is bash in sh-mode and overrode its kernel process name, so
    // pty.process reported "bash" for an idle shell — a mismatch the tpgid
    // disambiguator handled. The foreground state now comes from the shell
    // hook, which /bin/sh doesn't install, so the alias can no longer mislead.)
    manager = createManager(150);
    const ws = createFakeSocket();
    const spawned = manager.spawnAndAttach(ws, shellInput);
    expect(spawned).not.toBeNull();
    if (!spawned) return;

    // Force output idleness without clearing hasForeground: /bin/sh has no
    // hook, so hasForeground is already false and the idle shell reads "ready".
    manager.markOutputIdleForTest(spawned.id);
    expect(manager.list()[0]?.state).toBe("ready");

    manager.detach(ws);
    expect(manager.size()).toBe(1);

    // Grace elapsed, state was "ready" → reaped. No zombie, no stuck orphan.
    expect(await pollFor(() => manager.size() === 0)).toBe(true);
    expect(spawned.session.isExited).toBe(true);
  }, 10_000);

  it("never reaps a dormant shell while the grace window is Off, then reaps on rearm", async () => {
    // `null` = "never reap": detaching the last viewer parks the shell with no
    // timer, so an idle shell lingers until killed from the switcher or evicted
    // at the session cap. Flipping to a finite window and calling rearmGrace()
    // (the `PUT /api/config` → applyGraceSeconds path) arms the parked shell
    // and reaps it once idle.
    let grace: number | null = null;
    manager = new SessionManager({
      getGraceMs: () => grace,
      sendControl: () => {},
      hooks: {
        onOutputActivity: () => {},
        onSessionActivity: () => {},
        onSessionEvent: () => {},
        onAutomationExit: () => {},
        onClientExit: () => {},
      },
    });
    const ws = createFakeSocket();
    const spawned = manager.spawnAndAttach(ws, shellInput);
    expect(spawned).not.toBeNull();
    if (!spawned) return;

    manager.markIdleForTest(spawned.id);
    manager.detach(ws);
    expect(manager.size()).toBe(1);

    await wait(300);
    // No timer was armed → the idle shell stays parked.
    expect(manager.size()).toBe(1);
    expect(spawned.session.isExited).toBe(false);

    // Flip Off → 150ms and re-arm (mirrors `PUT /api/config`).
    grace = 150;
    manager.rearmGrace();
    expect(await pollFor(() => manager.size() === 0)).toBe(true);
    expect(spawned.session.isExited).toBe(true);
  }, 10_000);

  it("keeps a dormant shell alive while the hook reports a foreground program (alive-quiet)", async () => {
    // The shell hook drives hasForeground via the session's `foreground` event
    // (preexec → fg;<token>, precmd → fg-idle). This exercises the grace reap's
    // foreground gate against that signal: a quiet-but-running program (set
    // here deterministically via markForegroundForTest, mirroring what the hook
    // would set) holds the shell past the grace window, and releasing it reaps.
    manager = createManager(150);
    const ws = createFakeSocket();
    const spawned = manager.spawnAndAttach(ws, shellInput);
    expect(spawned).not.toBeNull();
    if (!spawned) return;

    // A foreground program is running but output has gone quiet → alive-quiet.
    manager.markOutputIdleForTest(spawned.id);
    manager.markForegroundForTest(spawned.id);
    expect(manager.list()[0]?.state).toBe("alive-quiet");

    // With a client attached the grace timer isn't armed, so it survives.
    await wait(250);
    expect(manager.size()).toBe(1);
    expect(spawned.session.isExited).toBe(false);

    // The client leaves; the grace re-check sees alive-quiet and reschedules.
    manager.detach(ws);
    await wait(250);
    expect(manager.size()).toBe(1);
    expect(spawned.session.isExited).toBe(false);

    // The program exits (precmd → fg-idle) → ready → reaped.
    manager.markForegroundForTest(spawned.id, false);
    expect(await pollFor(() => manager.size() === 0)).toBe(true);
    expect(spawned.session.isExited).toBe(true);
  }, 10_000);

  it("returns null when attaching to an unknown id (caller spawns fresh)", () => {
    manager = createManager(60_000);
    const ws = createFakeSocket();
    expect(manager.attach(ws, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("reports the favicon-equivalent activity state on the session list", async () => {
    manager = createManager(60_000);
    const ws = createFakeSocket();
    const spawned = manager.spawnAndAttach(ws, shellInput);
    expect(spawned).not.toBeNull();
    if (!spawned) return;
    // A freshly-spawned shell just emitted its prompt — recent output → running.
    const states = manager.list().map((entry) => entry.state);
    expect(states).toContain("running");

    manager.markIdleForTest(spawned.id);
    // Idle with no foreground program → ready.
    expect(manager.list()[0]?.state).toBe("ready");
  }, 10_000);
});

describe("SessionManager pending promote", { tags: ["integration"] }, () => {
  const noopHooks = {
    onOutputActivity: () => {},
    onSessionActivity: () => {},
    onSessionEvent: () => {},
    onAutomationExit: () => {},
    onClientExit: () => {},
  };
  let manager: SessionManager;

  afterEach(() => {
    manager?.disposeAll();
  });

  it("sends replay-end on an auto-promote so a slow client never deadlocks in its replay window", async () => {
    // The client opens its suppressed-replay window on the {session} frame —
    // before its {ready} can race back over a slow (mobile / DERP-relayed)
    // link. When the pending timeout auto-promotes with `replay: false` it
    // must still send `replay-end`, or the client waits for a marker that
    // never comes and buffers every output frame in `replayChunks` forever
    // (a blank screen only a session-picker switch can recover).
    const sentControl: ServerToClientMessage[] = [];
    manager = new SessionManager({
      pendingPromoteTimeoutMs: 40,
      sendControl: (_ws, payload) => sentControl.push(payload),
      hooks: noopHooks,
    });
    const ws = createFakeSocket();
    manager.spawnAndAttach(ws, shellInput);
    // Never send {ready} — the pending timer auto-promotes after 40ms.
    expect(await pollFor(() => sentControl.some((message) => message.type === "replay-end"))).toBe(
      true,
    );
  }, 10_000);

  it("sends replay-end even when the client asks for no scrollback replay", () => {
    const sentControl: ServerToClientMessage[] = [];
    manager = new SessionManager({
      pendingPromoteTimeoutMs: 60_000,
      sendControl: (_ws, payload) => sentControl.push(payload),
      hooks: noopHooks,
    });
    const ws = createFakeSocket();
    manager.spawnAndAttach(ws, shellInput);
    manager.promote(ws, false);
    expect(sentControl).toContainEqual({ type: "replay-end" });
  });
});

describe("SessionManager multi-viewer coordination", { tags: ["integration"] }, () => {
  const noopHooks = {
    onOutputActivity: () => {},
    onSessionEvent: () => {},
    onAutomationExit: () => {},
    onClientExit: () => {},
    onSessionActivity: () => {},
  };
  let manager: SessionManager;

  afterEach(() => {
    manager?.disposeAll();
  });

  it("broadcasts peer-attached to existing clients when a second client attaches", () => {
    const sent: { ws: ClientSocket; payload: ServerToClientMessage }[] = [];
    manager = new SessionManager({
      sendControl: (ws, payload) => sent.push({ ws, payload }),
      hooks: noopHooks,
    });
    const first = createFakeSocket();
    const spawned = manager.spawnAndAttach(first, shellInput);
    expect(spawned).not.toBeNull();
    if (!spawned) return;
    // Model the desktop having caught up (it sent {ready} on its session
    // frame long before a mobile ingests): promote it to live fan-out so the
    // peer-attached broadcast reaches it via sendControl, not its pending
    // queue.
    manager.promote(first, false);
    // A fresh spawn's first attach has no existing subscribers to notify.
    expect(sent.filter((entry) => entry.payload.type === "peer-attached")).toEqual([]);

    // A second tab joins the same live PTY (a mobile ingested the share QR).
    const second = createFakeSocket();
    manager.attach(second, spawned.id);
    const peerAttached = sent.filter((entry) => entry.payload.type === "peer-attached");
    expect(peerAttached).toHaveLength(1);
    expect(peerAttached[0].ws).toBe(first);
    expect(peerAttached[0].payload).toEqual({ type: "peer-attached" });
  });

  it("accepts user input from every viewer but only one generated response", () => {
    manager = new SessionManager({ sendControl: () => {}, hooks: noopHooks });
    const desktop = createFakeSocket();
    const phone = createFakeSocket();
    const spawned = manager.spawnAndAttach(desktop, shellInput);
    expect(spawned).not.toBeNull();
    if (!spawned) return;
    manager.attach(phone, spawned.id);
    void manager.promote(desktop, false);
    void manager.promote(phone, false);
    const write = vi.spyOn(spawned.session, "write").mockImplementation(() => {});

    manager.writeTerminalResponse(phone, "dropped-phone-response");
    manager.writeTerminalResponse(desktop, "desktop-response");
    manager.writeInput(phone, "phone-user-input");
    manager.writeTerminalResponse(desktop, "dropped-desktop-response");
    manager.writeTerminalResponse(phone, "phone-response");
    expect(write.mock.calls).toEqual([
      ["desktop-response"],
      ["phone-user-input"],
      ["phone-response"],
    ]);

    manager.detach(phone);
    manager.writeTerminalResponse(desktop, "promoted-desktop-response");
    expect(write).toHaveBeenCalledTimes(4);
    expect(write).toHaveBeenLastCalledWith("promoted-desktop-response");
  });
});

describe("SessionManager pty-size", { tags: ["integration"] }, () => {
  const noopHooks = {
    onOutputActivity: () => {},
    onSessionActivity: () => {},
    onSessionEvent: () => {},
    onAutomationExit: () => {},
    onClientExit: () => {},
  };
  let manager: SessionManager;

  afterEach(() => {
    manager?.disposeAll();
  });

  it("leaves a lone viewer quiet — no pty-size frame on resize", () => {
    const sent: { ws: ClientSocket; payload: ServerToClientMessage }[] = [];
    manager = new SessionManager({
      sendControl: (ws, payload) => sent.push({ ws, payload }),
      hooks: noopHooks,
    });
    const desktop = createFakeSocket();
    manager.spawnAndAttach(desktop, shellInput);
    manager.promote(desktop, false);
    manager.resize(desktop, 120, 40);
    manager.resize(desktop, 100, 30);
    expect(sent.filter((entry) => entry.payload.type === "pty-size")).toEqual([]);
  });

  it("broadcasts the constrained size when a narrower peer joins and clears it when the peer leaves", () => {
    const sent: { ws: ClientSocket; payload: ServerToClientMessage }[] = [];
    manager = new SessionManager({
      sendControl: (ws, payload) => sent.push({ ws, payload }),
      hooks: noopHooks,
    });
    const desktop = createFakeSocket();
    const spawned = manager.spawnAndAttach(desktop, shellInput);
    expect(spawned).not.toBeNull();
    if (!spawned) return;
    manager.promote(desktop, false);
    manager.resize(desktop, 120, 40);
    // Lone desktop: unconstrained, so no pty-size frame.
    expect(sent.filter((entry) => entry.payload.type === "pty-size")).toEqual([]);

    // A mobile ingests the share QR and reports its narrow viewport.
    const mobile = createFakeSocket();
    manager.attach(mobile, spawned.id);
    manager.promote(mobile, false);
    manager.resize(mobile, 40, 24);
    const constrained = sent.filter(
      (entry) =>
        entry.payload.type === "pty-size" && entry.payload.cols === 40 && entry.payload.rows === 24,
    );
    // Both viewers learn the effective size — the mobile is the limiter so its
    // own grid matches (no mask); the desktop masks the dead area.
    expect(constrained.some((entry) => entry.ws === desktop)).toBe(true);
    expect(constrained.some((entry) => entry.ws === mobile)).toBe(true);

    // The mobile leaves → the desktop is unconstrained again → one clear frame
    // at the lone viewer's own size so the mask erases.
    sent.length = 0;
    manager.detach(mobile);
    expect(sent.filter((entry) => entry.payload.type === "pty-size")).toEqual([
      { ws: desktop, payload: { type: "pty-size", cols: 120, rows: 40 } },
    ]);
  });

  it("seeds a wider joiner with the current constrained size when its report doesn't change the min", () => {
    const sent: { ws: ClientSocket; payload: ServerToClientMessage }[] = [];
    manager = new SessionManager({
      sendControl: (ws, payload) => sent.push({ ws, payload }),
      hooks: noopHooks,
    });
    const desktop = createFakeSocket();
    const spawned = manager.spawnAndAttach(desktop, shellInput);
    expect(spawned).not.toBeNull();
    if (!spawned) return;
    manager.promote(desktop, false);
    manager.resize(desktop, 120, 40);
    // A mobile constrains the PTY to its narrow viewport.
    const mobile = createFakeSocket();
    manager.attach(mobile, spawned.id);
    manager.promote(mobile, false);
    manager.resize(mobile, 40, 24);
    sent.length = 0;
    // A second desktop joins — wider than the mobile's limit, so the min stays
    // 40 and recomputeResize doesn't broadcast. The joiner must still learn it's
    // constrained via the seed, or it would render no mask over its wide grid.
    const secondDesktop = createFakeSocket();
    manager.attach(secondDesktop, spawned.id);
    manager.promote(secondDesktop, false);
    manager.resize(secondDesktop, 120, 40);
    const seeded = sent.filter(
      (entry) =>
        entry.ws === secondDesktop &&
        entry.payload.type === "pty-size" &&
        entry.payload.cols === 40 &&
        entry.payload.rows === 24,
    );
    expect(seeded.length).toBeGreaterThan(0);
  });
});

describe("SessionManager sessionsInPath", { tags: ["integration"] }, () => {
  let manager: SessionManager;

  afterEach(() => {
    manager?.disposeAll();
  });

  // A spawned PTY with no client is still "live" — it sits in the registry
  // until killed or reaped, the same shape as a dormant PTY parked in the
  // no-clients grace window. sessionsInPath reads the registry, so it covers
  // attached, dormant, and automation PTYs alike.
  it("reports a live PTY whose cwd is inside the target, and nothing for an unrelated path", () => {
    manager = createManager(60_000);
    const worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), "wt-guard-"));
    const siblingDir = fs.mkdtempSync(path.join(os.tmpdir(), "wt-sibling-"));
    try {
      const spawned = manager.spawn({ shell: "/bin/sh", cwd: worktreeDir });
      expect(spawned).not.toBeNull();
      if (!spawned) return;

      const onWorktree = manager.sessionsInPath(worktreeDir);
      expect(onWorktree).toHaveLength(1);
      expect(onWorktree[0].id).toBe(spawned.id);
      expect(manager.sessionsInPath(siblingDir)).toHaveLength(0);
    } finally {
      manager?.disposeAll();
      fs.rmSync(worktreeDir, { recursive: true, force: true });
      fs.rmSync(siblingDir, { recursive: true, force: true });
    }
  });

  it("still reports a PTY that has detached and parked with no clients (dormant)", () => {
    manager = createManager(60_000);
    const worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), "wt-dormant-"));
    try {
      const ws = createFakeSocket();
      const spawned = manager.spawnAndAttach(ws, { shell: "/bin/sh", cwd: worktreeDir });
      expect(spawned).not.toBeNull();
      if (!spawned) return;

      // Last client leaves → the PTY parks with no clients (dormant) for the
      // grace window. It's still a live process the session picker can re-attach
      // to, so a worktree removal must stay blocked.
      manager.detach(ws);
      expect(manager.size()).toBe(1);
      expect(manager.sessionsInPath(worktreeDir)).toHaveLength(1);
    } finally {
      manager?.disposeAll();
      fs.rmSync(worktreeDir, { recursive: true, force: true });
    }
  });

  it("matches a shell in a subdirectory of the worktree (containment)", () => {
    manager = createManager(60_000);
    const worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), "wt-parent-"));
    const subDir = path.join(worktreeDir, "sub");
    fs.mkdirSync(subDir);
    try {
      const spawned = manager.spawn({ shell: "/bin/sh", cwd: subDir });
      expect(spawned).not.toBeNull();
      expect(manager.sessionsInPath(worktreeDir)).toHaveLength(1);
    } finally {
      manager?.disposeAll();
      fs.rmSync(worktreeDir, { recursive: true, force: true });
    }
  });

  it("does not match a shell in the worktree for a sub-path of it", () => {
    manager = createManager(60_000);
    const worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), "wt-child-"));
    const subDir = path.join(worktreeDir, "sub");
    fs.mkdirSync(subDir);
    try {
      const spawned = manager.spawn({ shell: "/bin/sh", cwd: worktreeDir });
      expect(spawned).not.toBeNull();
      expect(manager.sessionsInPath(subDir)).toHaveLength(0);
    } finally {
      manager?.disposeAll();
      fs.rmSync(worktreeDir, { recursive: true, force: true });
    }
  });

  it("does not match a sibling whose name only shares a prefix", () => {
    manager = createManager(60_000);
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "wt-prefix-"));
    const target = path.join(base, "foo");
    const sibling = path.join(base, "foobar");
    fs.mkdirSync(target);
    fs.mkdirSync(sibling);
    try {
      const spawned = manager.spawn({ shell: "/bin/sh", cwd: sibling });
      expect(spawned).not.toBeNull();
      expect(manager.sessionsInPath(target)).toHaveLength(0);
    } finally {
      manager?.disposeAll();
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

describe("SessionManager notification fan-out", { tags: ["integration"] }, () => {
  const noopHooks = {
    onOutputActivity: () => {},
    onSessionActivity: () => {},
    onSessionEvent: () => {},
    onAutomationExit: () => {},
    onClientExit: () => {},
  };
  let manager: SessionManager;

  afterEach(() => {
    manager?.disposeAll();
  });

  it("delivers a notification to a same-owner client viewing a different session", () => {
    const sent: { ws: ClientSocket; payload: ServerToClientMessage }[] = [];
    manager = new SessionManager({
      sendControl: (ws, payload) => sent.push({ ws, payload }),
      hooks: noopHooks,
    });
    const a = createFakeSocket();
    const b = createFakeSocket();
    const first = manager.spawnAndAttach(a, shellInput);
    const second = manager.spawnAndAttach(b, shellInput);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    if (!first || !second) return;
    // Promote so sendControl delivers immediately instead of buffering.
    manager.promote(a, false);
    manager.promote(b, false);

    // `a` views `first`, `b` views `second`; `first` emits an OSC 9 notification.
    manager.emitNotificationForTest(first.id, "build done");
    const notifications = sent.filter((entry) => entry.payload.type === "notification");
    // `b` — viewing a different session — still receives `first`'s notification.
    expect(notifications.some((entry) => entry.ws === a)).toBe(true);
    expect(notifications.some((entry) => entry.ws === b)).toBe(true);
    const toB = notifications.find((entry) => entry.ws === b)?.payload;
    expect(toB).toEqual({
      type: "notification",
      sessionId: first.id,
      body: "build done",
      hasViewers: true,
    });
  });

  it("flags an orphaned session (no viewer) so a click can reopen it", () => {
    const sent: { ws: ClientSocket; payload: ServerToClientMessage }[] = [];
    manager = new SessionManager({
      sendControl: (ws, payload) => sent.push({ ws, payload }),
      hooks: noopHooks,
    });
    const a = createFakeSocket();
    const b = createFakeSocket();
    const first = manager.spawnAndAttach(a, shellInput);
    const second = manager.spawnAndAttach(b, shellInput);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    if (!first || !second) return;
    manager.promote(a, false);
    manager.promote(b, false);
    // `a`'s tab closed (detach); `first` is now viewerless but kept alive by
    // the daemon. `b`, viewing `second`, still gets the ping — flagged so a
    // click opens a fresh tab on `first` instead of assuming it's viewed.
    manager.detach(a);
    manager.emitNotificationForTest(first.id, "build done");
    const notifications = sent.filter((entry) => entry.payload.type === "notification");
    const toB = notifications.find((entry) => entry.ws === b)?.payload;
    expect(toB).toEqual({
      type: "notification",
      sessionId: first.id,
      body: "build done",
      hasViewers: false,
    });
  });

  it("does not deliver a notification across an owner boundary", () => {
    const sent: { ws: ClientSocket; payload: ServerToClientMessage }[] = [];
    manager = new SessionManager({
      sendControl: (ws, payload) => sent.push({ ws, payload }),
      hooks: noopHooks,
    });
    const ownerA = createFakeSocket();
    const ownerB = createFakeSocket();
    const a = manager.spawnAndAttach(ownerA, shellInput, undefined, "identity-A");
    const b = manager.spawnAndAttach(ownerB, shellInput, undefined, "identity-B");
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    if (!a || !b) return;
    manager.promote(ownerA, false);
    manager.promote(ownerB, false);

    manager.emitNotificationForTest(a.id, "owner-A ping");
    const notifications = sent.filter((entry) => entry.payload.type === "notification");
    expect(notifications.some((entry) => entry.ws === ownerA)).toBe(true);
    expect(notifications.some((entry) => entry.ws === ownerB)).toBe(false);
  });
});
