import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  CaffeinateController,
  type CaffeinateProcessHandle,
} from "../src/caffeinate-controller.js";
import { CaffeinateManager } from "../src/caffeinate-manager.js";
import { CAFFEINATE_BATTERY_POLL_MAX_INTERVAL_MS } from "../src/constants.js";
import { CaffeinatePreferencesStore } from "../src/caffeinate-preferences-store.js";
import type { ProcessSnapshotEntry } from "../src/caffeinate-process-match.js";

const createFakeController = (supported = true) => {
  const spawned: { killed: boolean }[] = [];
  const controller = new CaffeinateController({
    supported,
    spawnProcess: (): CaffeinateProcessHandle => {
      const fake = { killed: false };
      spawned.push(fake);
      return { kill: () => (fake.killed = true), onExit: () => {} };
    },
  });
  return { controller, spawned };
};

const claudeUnderSession = (shellPid: number): ProcessSnapshotEntry[] => [
  { pid: shellPid, ppid: 1, command: "-zsh" },
  { pid: shellPid + 1, ppid: shellPid, command: "node /opt/homebrew/bin/claude" },
];

describe("CaffeinateManager", () => {
  let dir: string;
  let store: CaffeinatePreferencesStore;
  let sessionPids: number[];
  let snapshot: ProcessSnapshotEntry[];
  let recentOutputPids: number[];
  let peerClientPresent: boolean;
  let batteryStatus: {
    percent: number;
    isOnBattery: boolean;
    minutesToEmpty: number | null;
  } | null;

  const build = (supported = true) => {
    const { controller, spawned } = createFakeController(supported);
    const manager = new CaffeinateManager({
      controller,
      store,
      listSessionPids: () => sessionPids,
      snapshotProcesses: async () => snapshot,
      hasRecentOutput: (pids) => pids.some((pid) => recentOutputPids.includes(pid)),
      hasPeerClient: () => peerClientPresent,
      batteryProbe: async () => batteryStatus,
    });
    return { manager, controller, spawned };
  };

  beforeEach(() => {
    dir = path.join(os.tmpdir(), `localterm-caffeinate-mgr-${randomUUID()}`);
    store = new CaffeinatePreferencesStore(path.join(dir, "caffeinate.json"));
    sessionPids = [];
    snapshot = [];
    recentOutputPids = [];
    peerClientPresent = false;
    // Default to a healthy plugged-out battery well above the 20% floor, so
    // the guard is armed but never suppresses unless a test sets a low value.
    batteryStatus = { percent: 80, isOnBattery: true, minutesToEmpty: 240 };
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("stays inactive in automatic mode with no matching process", async () => {
    const { manager, controller } = build();
    sessionPids = [100];
    snapshot = [{ pid: 100, ppid: 1, command: "-zsh" }];
    await manager.pollNow();
    expect(controller.active).toBe(false);
    manager.dispose();
  });

  it("is always active in on mode and never in off mode", async () => {
    const { manager, controller, spawned } = build();
    manager.setMode("on");
    // The first probe healthy battery -> caffeinate engages.
    await manager.pollBatteryNow();
    expect(controller.active).toBe(true);
    expect(spawned).toHaveLength(1);
    manager.setMode("off");
    expect(controller.active).toBe(false);
    expect(spawned[0].killed).toBe(true);
    manager.dispose();
  });

  it("activates in automatic mode when a recognized program runs in a session", async () => {
    const { manager, controller } = build();
    expect(manager.mode).toBe("automatic");
    sessionPids = [100];
    snapshot = claudeUnderSession(100);
    recentOutputPids = [100];
    await manager.pollNow();
    expect(controller.active).toBe(true);
    expect(manager.activeTrigger).toBe("claude");

    // Program exits → caffeinate releases.
    snapshot = [{ pid: 100, ppid: 1, command: "-zsh" }];
    await manager.pollNow();
    expect(controller.active).toBe(false);
    expect(manager.activeTrigger).toBeNull();
    manager.dispose();
  });

  it("releases when the last triggering session goes away", async () => {
    const { manager, controller } = build();
    sessionPids = [100];
    snapshot = claudeUnderSession(100);
    recentOutputPids = [100];
    await manager.pollNow();
    expect(controller.active).toBe(true);

    // Session disconnects: its pid is gone even though the (now-orphaned) row
    // lingers in the snapshot. This is the re-check the disconnect event drives.
    sessionPids = [];
    await manager.pollNow();
    expect(controller.active).toBe(false);
    manager.dispose();
  });

  it("honors a user-added custom command", async () => {
    const { manager, controller } = build();
    sessionPids = [100];
    snapshot = [
      { pid: 100, ppid: 1, command: "-zsh" },
      { pid: 101, ppid: 100, command: "/usr/local/bin/ollama serve" },
    ];
    await manager.pollNow();
    expect(controller.active).toBe(false); // not a default trigger yet

    manager.setCommands(["ollama"]);
    recentOutputPids = [100];
    await manager.pollNow();
    // First probe resolves the battery floor; with a healthy battery the
    // matched trigger engages.
    await manager.pollBatteryNow();
    expect(controller.active).toBe(true);
    expect(manager.activeTrigger).toBe("ollama");
    manager.dispose();
  });

  it("never activates when unsupported", async () => {
    const { manager, controller, spawned } = build(false);
    expect(manager.supported).toBe(false);
    manager.setMode("on");
    expect(controller.active).toBe(false);
    expect(spawned).toHaveLength(0);
    manager.dispose();
  });

  it("emits change on mode changes", () => {
    const { manager } = build();
    let changes = 0;
    manager.on("change", () => (changes += 1));
    manager.setMode("on");
    manager.setMode("off");
    expect(changes).toBeGreaterThanOrEqual(2);
    manager.dispose();
  });

  it("does not caffeinate when activity gate is on and no recent output", async () => {
    const { manager, controller } = build();
    sessionPids = [100];
    snapshot = claudeUnderSession(100);
    // recentOutputPids is empty — no recent output from session 100.
    expect(manager.activityGate).toBe(true);
    await manager.pollNow();
    expect(controller.active).toBe(false);
    manager.dispose();
  });

  it("caffeinate when activity gate is on and recent output exists", async () => {
    const { manager, controller } = build();
    sessionPids = [100];
    snapshot = claudeUnderSession(100);
    recentOutputPids = [100];
    await manager.pollNow();
    expect(controller.active).toBe(true);
    manager.dispose();
  });

  it("caffeinate when activity gate is off even without recent output", async () => {
    const { manager, controller } = build();
    sessionPids = [100];
    snapshot = claudeUnderSession(100);
    // recentOutputPids is empty.
    manager.setActivityGate(false);
    expect(manager.activityGate).toBe(false);
    await manager.pollNow();
    expect(controller.active).toBe(true);
    manager.dispose();
  });

  it("toggling activity gate on re-checks output activity", async () => {
    const { manager, controller } = build();
    sessionPids = [100];
    snapshot = claudeUnderSession(100);
    // Gate off: caffeinate with no output.
    manager.setActivityGate(false);
    await manager.pollNow();
    expect(controller.active).toBe(true);

    // Gate on again: no recent output → should release.
    manager.setActivityGate(true);
    await manager.pollNow();
    expect(controller.active).toBe(false);
    manager.dispose();
  });

  it("noteOutputActivity resets the activity gate timer", async () => {
    const { manager, controller } = build();
    sessionPids = [100];
    snapshot = claudeUnderSession(100);
    recentOutputPids = [100];
    await manager.pollNow();
    expect(controller.active).toBe(true);

    // Output no longer recent (simulating idle after debounce).
    recentOutputPids = [];
    // noteOutputActivity should be a no-op when autoActive is true but
    // the gate timer is armed — it resets the timer.
    manager.noteOutputActivity();
    manager.dispose();
  });

  it("activates in automatic mode when a peer is attached, bypassing the activity gate", async () => {
    const { manager, controller } = build();
    // No recognized program, no recent output, activity gate on — a peer
    // alone must hold caffeinate (an idle-but-attached phone is the point).
    sessionPids = [100];
    snapshot = [{ pid: 100, ppid: 1, command: "-zsh" }];
    peerClientPresent = true;
    expect(manager.peerKeepAwake).toBe(true);
    await manager.pollNow();
    expect(controller.active).toBe(true);
    expect(manager.activeTrigger).toBeNull();
    expect(manager.peerActive).toBe(true);
    manager.dispose();
  });

  it("releases when the peer disconnects", async () => {
    const { manager, controller } = build();
    sessionPids = [100];
    snapshot = [{ pid: 100, ppid: 1, command: "-zsh" }];
    peerClientPresent = true;
    await manager.pollNow();
    expect(controller.active).toBe(true);

    // Peer detaches (the disconnect event drives this re-check).
    peerClientPresent = false;
    await manager.pollNow();
    expect(controller.active).toBe(false);
    expect(manager.activeTrigger).toBeNull();
    expect(manager.peerActive).toBe(false);
    manager.dispose();
  });

  it("does not caffeinate for a peer when peer keep-awake is off", async () => {
    const { manager, controller } = build();
    sessionPids = [100];
    snapshot = [{ pid: 100, ppid: 1, command: "-zsh" }];
    peerClientPresent = true;
    manager.setPeerKeepAwake(false);
    expect(manager.peerKeepAwake).toBe(false);
    await manager.pollNow();
    expect(controller.active).toBe(false);
    manager.dispose();
  });

  it("surfaces the program trigger and peer hold independently", async () => {
    const { manager, controller } = build();
    sessionPids = [100];
    snapshot = claudeUnderSession(100);
    recentOutputPids = [100];
    peerClientPresent = true;
    await manager.pollNow();
    expect(controller.active).toBe(true);
    // Both triggers hold: the program name is in `activeTrigger` (the more
    // specific signal) and the peer hold is in `peerActive`, so the UI can
    // highlight each setting row on its own.
    expect(manager.activeTrigger).toBe("claude");
    expect(manager.peerActive).toBe(true);

    // Program goes idle; the peer still holds, so caffeinate stays active and
    // the program trigger clears while the peer hold remains.
    recentOutputPids = [];
    snapshot = [{ pid: 100, ppid: 1, command: "-zsh" }];
    await manager.pollNow();
    expect(controller.active).toBe(true);
    expect(manager.activeTrigger).toBeNull();
    expect(manager.peerActive).toBe(true);
    manager.dispose();
  });

  it("does not arm the activity-gate silence timer while a peer holds", async () => {
    const { manager, controller } = build();
    sessionPids = [100];
    snapshot = [{ pid: 100, ppid: 1, command: "-zsh" }];
    peerClientPresent = true;
    await manager.pollNow();
    expect(controller.active).toBe(true);

    // Output arriving while a peer holds must not arm a trailing-edge timer
    // (the peer releases on disconnect, not on silence).
    manager.noteOutputActivity();
    // No way to observe the timer directly without a clock; the contract is
    // that a subsequent poll with the peer gone releases at once, which only
    // holds if no stale timer re-armed. Drive that transition:
    peerClientPresent = false;
    await manager.pollNow();
    expect(controller.active).toBe(false);
    manager.dispose();
  });

  it("broadcasts when the trigger identity changes while caffeinate stays active", async () => {
    const { manager } = build();
    let changes = 0;
    manager.on("change", () => (changes += 1));

    // Peer attaches: caffeinate activates (autoActive false -> true).
    sessionPids = [100];
    snapshot = [{ pid: 100, ppid: 1, command: "-zsh" }];
    peerClientPresent = true;
    await manager.pollNow();
    expect(manager.peerActive).toBe(true);
    expect(manager.activeTrigger).toBeNull();
    const changesAfterPeer = changes;

    // A program starts while the peer holds: autoActive stays true, but
    // activeTrigger flips null -> "claude". This must broadcast so the UI
    // re-highlights the program chip and activity-gate row.
    snapshot = claudeUnderSession(100);
    recentOutputPids = [100];
    await manager.pollNow();
    expect(manager.activeTrigger).toBe("claude");
    expect(manager.peerActive).toBe(true);
    expect(changes).toBeGreaterThan(changesAfterPeer);

    // The peer leaves while the program runs: autoActive stays true, but
    // peerActive flips true -> false. This must broadcast so the peer row
    // stops highlighting.
    const changesAfterProgram = changes;
    peerClientPresent = false;
    await manager.pollNow();
    expect(manager.peerActive).toBe(false);
    expect(manager.activeTrigger).toBe("claude");
    expect(changes).toBeGreaterThan(changesAfterProgram);
    manager.dispose();
  });
});

describe("CaffeinateManager battery floor", () => {
  let dir: string;
  let store: CaffeinatePreferencesStore;
  let sessionPids: number[];
  let snapshot: ProcessSnapshotEntry[];
  let recentOutputPids: number[];
  let batteryStatus: {
    percent: number;
    isOnBattery: boolean;
    minutesToEmpty: number | null;
  } | null;

  const build = (supported = true) => {
    const { controller, spawned } = createFakeController(supported);
    const manager = new CaffeinateManager({
      controller,
      store,
      listSessionPids: () => sessionPids,
      snapshotProcesses: async () => snapshot,
      hasRecentOutput: (pids) => pids.some((pid) => recentOutputPids.includes(pid)),
      batteryProbe: async () => batteryStatus,
    });
    return { manager, controller, spawned };
  };

  beforeEach(() => {
    dir = path.join(os.tmpdir(), `localterm-caffeinate-battery-${randomUUID()}`);
    store = new CaffeinatePreferencesStore(path.join(dir, "caffeinate.json"));
    sessionPids = [];
    snapshot = [];
    recentOutputPids = [];
    batteryStatus = { percent: 80, isOnBattery: true, minutesToEmpty: 240 };
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("defaults the threshold to 20%", () => {
    const { manager } = build();
    expect(manager.batteryThreshold).toBe(20);
    manager.dispose();
  });

  it("suppresses caffeinate in on mode when below the floor on battery", async () => {
    const { manager, controller, spawned } = build();
    batteryStatus = { percent: 15, isOnBattery: true, minutesToEmpty: 30 };
    manager.setMode("on");
    // The first arming probes immediately; below 20% on battery -> suppress.
    await manager.pollBatteryNow();
    expect(controller.active).toBe(false);
    expect(spawned).toHaveLength(0);
    manager.dispose();
  });

  it("does not suppress when below the floor but on AC power", async () => {
    const { manager, controller } = build();
    batteryStatus = { percent: 5, isOnBattery: false, minutesToEmpty: null };
    manager.setMode("on");
    await manager.pollBatteryNow();
    expect(controller.active).toBe(true);
    manager.dispose();
  });

  it("resumes caffeinate when the battery charges back above the floor", async () => {
    const { manager, controller } = build();
    batteryStatus = { percent: 15, isOnBattery: true, minutesToEmpty: 30 };
    manager.setMode("on");
    await manager.pollBatteryNow();
    expect(controller.active).toBe(false);

    batteryStatus = { percent: 80, isOnBattery: true, minutesToEmpty: 240 };
    await manager.pollBatteryNow();
    expect(controller.active).toBe(true);
    manager.dispose();
  });

  it("resumes caffeinate immediately when the user unplugs and is above the floor", async () => {
    const { manager, controller } = build();
    batteryStatus = { percent: 5, isOnBattery: false, minutesToEmpty: null };
    manager.setMode("on");
    await manager.pollBatteryNow();
    expect(controller.active).toBe(true);

    // Unplug at 80% — still well above the floor, so the floor should not suppress.
    batteryStatus = { percent: 80, isOnBattery: true, minutesToEmpty: 240 };
    await manager.pollBatteryNow();
    expect(controller.active).toBe(true);
    manager.dispose();
  });

  it("does not suppress when the guard is disabled (null threshold)", async () => {
    const { manager, controller } = build();
    batteryStatus = { percent: 5, isOnBattery: true, minutesToEmpty: 3 };
    manager.setMode("on");
    manager.setBatteryThreshold(null);
    await manager.pollBatteryNow();
    expect(manager.batteryThreshold).toBeNull();
    expect(controller.active).toBe(true);
    manager.dispose();
  });

  it("suppresses on the first probe without waiting for the adaptive timer", async () => {
    // Guards against a regression where the first arm would wait MAX_INTERVAL
    // before applying the floor — a freshly-booted on-mode with the battery
    // already low would hold a power assertion for up to a minute.
    const { manager, controller } = build();
    batteryStatus = { percent: 10, isOnBattery: true, minutesToEmpty: 20 };
    manager.setMode("on");
    // No manual pollBatteryNow from production paths — the immediate probe
    // driven by setMode -> recompute -> scheduleBatteryCheck(null) settles it.
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    expect(controller.active).toBe(false);
    manager.dispose();
  });

  it("reevaluates the floor when the threshold is raised above the current charge", async () => {
    const { manager, controller } = build();
    batteryStatus = { percent: 25, isOnBattery: true, minutesToEmpty: 60 };
    manager.setMode("on");
    // 25% > 20% -> active under the default floor.
    await manager.pollBatteryNow();
    expect(controller.active).toBe(true);

    // Raise the floor above the current charge -> suppress.
    manager.setBatteryThreshold(30);
    await manager.pollBatteryNow();
    expect(controller.active).toBe(false);
    manager.dispose();
  });

  it("fails open when the probe returns null (no battery / read failure)", async () => {
    const { manager, controller } = build();
    batteryStatus = null;
    manager.setMode("on");
    await manager.pollBatteryNow();
    expect(controller.active).toBe(true);
    manager.dispose();
  });

  it("retries on the MAX interval after a failing probe instead of going silent", async () => {
    // Regression guard: a null status used to make scheduleBatteryCheck return
    // without arming a timer, so a transient `pmset` failure left the guard
    // silently un-armed (no retry until an external poke). The fix arms a
    // MAX-interval retry so the guard self-heals instead of going silent.
    vi.useFakeTimers();
    try {
      let probeCount = 0;
      const { controller } = createFakeController(true);
      const manager = new CaffeinateManager({
        controller,
        store,
        listSessionPids: () => [],
        snapshotProcesses: async () => [],
        batteryProbe: async () => {
          probeCount += 1;
          return null;
        },
      });
      manager.setMode("on");
      // First probe fires immediately on arm; flush its microtasks.
      await vi.advanceTimersByTimeAsync(0);
      expect(probeCount).toBe(1);
      // Nothing fires short of the MAX retry interval (the guard is armed, not
      // busy-looping at microtask latency).
      await vi.advanceTimersByTimeAsync(CAFFEINATE_BATTERY_POLL_MAX_INTERVAL_MS - 1);
      expect(probeCount).toBe(1);
      // At MAX the retry timer fires — the guard stays alive and re-probes
      // instead of going silent after the first failure.
      await vi.advanceTimersByTimeAsync(1);
      expect(probeCount).toBe(2);
      expect(controller.active).toBe(true); // still fail-open
      manager.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not run the probe while the mode does not want active", async () => {
    let probed = false;
    const { controller, spawned } = createFakeController(true);
    const manager = new CaffeinateManager({
      controller,
      store,
      listSessionPids: () => [],
      snapshotProcesses: async () => [],
      batteryProbe: async () => {
        probed = true;
        return batteryStatus;
      },
    });
    // automatic mode with no sessions -> wantActive false -> no probe.
    await manager.pollBatteryNow();
    expect(probed).toBe(false);
    expect(spawned).toHaveLength(0);
    manager.dispose();
  });
});
