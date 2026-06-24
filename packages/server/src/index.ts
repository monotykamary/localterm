import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serve, type ServerType } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { Hono } from "hono";
import open from "open";
import { AutomationRunTracker } from "./automation-run-tracker.js";
import { AutomationScheduler } from "./automation-scheduler.js";
import { AutomationStore } from "./automation-store.js";
import type { BatteryProbe } from "./caffeinate-battery.js";
import { CaffeinateController } from "./caffeinate-controller.js";
import { CaffeinateManager } from "./caffeinate-manager.js";
import { CaffeinatePreferencesStore } from "./caffeinate-preferences-store.js";
import type { SnapshotProcesses } from "./caffeinate-process-match.js";
import { CdpClient } from "./cdp/cdp-client.js";
import {
  AUTOMATION_RECONCILE_MIN_DOWNTIME_MS,
  AUTOMATION_EVENT_DEBOUNCE_MS,
  AUTOMATION_WATCH_DEBOUNCE_MS,
  AUTOMATION_WATCH_POST_RUN_GRACE_MS,
  DEFAULT_HOST,
  DEFAULT_PORT,
  FRIENDLY_HOSTNAME,
  GIT_MAX_REF_LENGTH,
  HTTP_STATUS_BAD_REQUEST,
  HTTP_STATUS_CREATED,
  HTTP_STATUS_NOT_FOUND,
  MAX_AUTOMATIONS,
  MAX_CONCURRENT_SESSIONS,
  MAX_OUTPUT_BYTES,
  MS_PER_MINUTE,
  OUTPUT_BATCH_FLUSH_BYTES,
  OUTPUT_BATCH_WINDOW_MS,
  SERVER_STOP_GRACE_MS,
  SESSION_GRACE_MS,
  SESSION_ID_QUERY_PARAM,
  WS_BACKPRESSURE_THRESHOLD_BYTES,
  WS_CLOSE_BACKPRESSURE,
  WS_CLOSE_CAPACITY_REACHED,
  WS_CLOSE_POLICY_VIOLATION,
  WS_HEARTBEAT_GRACE_MS,
  WS_HEARTBEAT_INTERVAL_MS,
  WS_HEARTBEAT_TIMEOUT_MS,
  WS_OUTBOUND_DRAIN_POLL_MS,
  WS_OUTBOUND_PAUSE_HIGH_WATER_BYTES,
  WS_OUTBOUND_RESUME_LOW_WATER_BYTES,
  WS_READY_STATE_OPEN,
} from "./constants.js";
import { getDefaultShell } from "./default-shell.js";
import { ServerErrorException, serverError } from "./errors.js";
import { FolderWatchManager } from "./folder-watch-manager.js";
import { SessionEventManager } from "./session-event-manager.js";
import {
  getGitBranchInfo,
  getGitBranchPr,
  getGitDiff,
  getGitDiffFilePatch,
  getGitDiffFiles,
  getGitDiffSummary,
  invalidateGitDiffCache,
  type GitDiffOptions,
} from "./git-diff.js";
import {
  GitDiffWatcher,
  GIT_DIFF_WATCHER_EVENT_NAMES,
  type GitRefEventName,
} from "./git-diff-watcher.js";
import { HeartbeatStore } from "./heartbeat-store.js";
import { parseCronExpression } from "./cron-expression.js";
import { createGitWorktree, listGitWorktrees, removeGitWorktree } from "./git-worktrees.js";
import {
  clientToServerMessageSchema,
  createAutomationInputSchema,
  createWorktreeInputSchema,
  launchInputSchema,
  resetAutomationInputSchema,
  updateAutomationInputSchema,
  updateWorktreeConfigInputSchema,
  worktreeIncludeFileInputSchema,
} from "./schemas.js";
import { Session } from "./session.js";
import { createNetworkPolicyMiddleware, isAllowedSourceIp, isLoopbackHost } from "./security.js";
import { SessionReattachPool, generateSessionId } from "./session-reattach-pool.js";
import { SessionRegistry } from "./session-registry.js";
import { resolveStaticAsset } from "./static-resolver.js";
import { sweepStaleWorktrees } from "./utils/worktree-sweep.js";
import {
  readWorktreeIncludeFile,
  writeWorktreeIncludeFile,
} from "./utils/worktree-include-file.js";
import { WorktreeConfigStore } from "./worktree-config-store.js";
import {
  compileSchedule,
  compileScheduleAll,
  normalizeTriggerInput,
} from "./utils/compile-schedule.js";
import { computeNextAutomationRunAt } from "./utils/compute-next-automation-run-at.js";
import { isLocaltermTabUrl } from "./utils/is-localterm-tab-url.js";
import { enumerateMissedOccurrences } from "./utils/reconcile-downtime.js";
import type {
  Automation,
  AutomationLastRun,
  AutomationWithNextRun,
  PendingAutomationRun,
  ServerToClientMessage,
  TriggerInput,
} from "./types.js";

export interface ServerOptions {
  port?: number;
  host?: string;
  staticRoot?: string | null;
  stateDirectory?: string;
  /**
   * Override how automation run tabs are opened and closed. When provided, the
   * caller owns tab control and the built-in CDP background-tab path is
   * disabled. Defaults to: CDP background tab (closeable) when a debug-enabled
   * Chromium browser is reachable, else the OS opener (`open -g`, not
   * closeable).
   */
  tabController?: AutomationTabController;
  /**
   * Override the keep-awake controller. Defaults to a `caffeinate -dims`-backed
   * controller, enabled only on macOS. Injectable so tests never hold a real
   * power assertion.
   */
  caffeinateController?: CaffeinateController;
  /**
   * Override how automatic-mode keep-awake inspects running processes. Defaults
   * to a real `ps` snapshot. Injectable so tests can drive automatic detection
   * deterministically without spawning processes.
   */
  caffeinateSnapshotProcesses?: SnapshotProcesses;
  /**
   * Override how keep-awake reads the machine's battery. Defaults to a real
   * `pmset -g batt` read. Injectable so tests can drive the battery floor
   * deterministically without shelling out.
   */
  caffeinateBatteryProbe?: BatteryProbe;
}

/** Opens and (optionally) closes the browser tab for an automation run. */
export interface AutomationTabController {
  /**
   * Open `url` in a background tab. Returns an opaque handle used to close the
   * tab later (when the automation has `closeOnFinish`), or null when the tab
   * can't be closed programmatically (e.g. the OS-opener fallback).
   */
  open: (url: string) => Promise<string | null>;
  /** Close a tab previously opened by `open`. Best-effort; never throws. */
  close: (handle: string) => Promise<void>;
}

export interface RunningServer {
  port: number;
  host: string;
  registry: SessionRegistry;
  stop: () => Promise<void>;
}

interface BroadcastSocket {
  readyState: number;
  // Accepts a UTF-8 JSON string for control frames (title, exit, etc.) or a
  // raw Uint8Array<ArrayBuffer> for binary PTY output frames, which bypass JSON
  // entirely — see sendOutputBytes/sendOutputBatchBytes. Matches the underlying
  // WSContext.send signature from @hono/node-ws exactly so the ws argument from
  // onOpen(ws) is assignable to this interface.
  send: (raw: string | ArrayBuffer | Uint8Array<ArrayBuffer>) => void;
  close: (code?: number, reason?: string) => void;
  raw?: unknown;
}

const getRawBufferedAmount = (raw: unknown): number => {
  if (!raw || typeof raw !== "object") return 0;
  const candidate = Reflect.get(raw, "bufferedAmount");
  return typeof candidate === "number" ? candidate : 0;
};

const callRawMethod = (raw: unknown, method: "ping" | "terminate"): boolean => {
  if (!raw || typeof raw !== "object") return false;
  const candidate = Reflect.get(raw, method);
  if (typeof candidate !== "function") return false;
  try {
    candidate.call(raw);
    return true;
  } catch {
    return false;
  }
};

const onRawEvent = (raw: unknown, event: "pong", listener: () => void): (() => void) | null => {
  if (!raw || typeof raw !== "object") return null;
  const on = Reflect.get(raw, "on");
  const off = Reflect.get(raw, "off");
  if (typeof on !== "function" || typeof off !== "function") return null;
  on.call(raw, event, listener);
  return () => {
    try {
      off.call(raw, event, listener);
    } catch {
      /* socket already torn down */
    }
  };
};

const extractRemoteAddress = (raw: unknown): string | null => {
  if (!raw || typeof raw !== "object") return null;
  const socket = Reflect.get(raw, "_socket");
  if (!socket || typeof socket !== "object") return null;
  const addr = Reflect.get(socket, "remoteAddress");
  return typeof addr === "string" ? addr : null;
};

const safeSend = (ws: BroadcastSocket, payload: ServerToClientMessage) => {
  if (ws.readyState !== WS_READY_STATE_OPEN) return;
  if (getRawBufferedAmount(ws.raw) > WS_BACKPRESSURE_THRESHOLD_BYTES) {
    ws.close(WS_CLOSE_BACKPRESSURE, "backpressure");
    return;
  }
  try {
    ws.send(JSON.stringify(payload));
  } catch {
    /* socket closed between readyState check and send */
  }
};

// Output frames travel as raw UTF-8 bytes, not JSON. JSON.stringify/parse on
// terminal output is the dominant per-byte cost on the renderer main thread
// (traced: ~36% of main-thread busy in steady-state cmatrix is JSON.parse of
// {"type":"output","data":"..."}, scaling linearly with payload size because of
// per-character escape scanning on both sides). PTY output is already bytes; the
// server UTF-8-encodes the accumulated string batch once at flush and emits a
// single binary frame. The client gets event.data as an ArrayBuffer and hands
// it to OutputBatcher with no JSON.parse, no string roundtrip. Splits at
// MAX_OUTPUT_BYTES as a safety cap on single-frame size (unreachable in
// practice — OUTPUT_BATCH_FLUSH_BYTES=32KB flushes well below this).
const sendOutputBytes = (ws: BroadcastSocket, bytes: Uint8Array<ArrayBuffer>) => {
  if (ws.readyState !== WS_READY_STATE_OPEN) return;
  if (getRawBufferedAmount(ws.raw) > WS_BACKPRESSURE_THRESHOLD_BYTES) {
    ws.close(WS_CLOSE_BACKPRESSURE, "backpressure");
    return;
  }
  try {
    ws.send(bytes);
  } catch {
    /* socket closed between readyState check and send */
  }
};

// Stateless UTF-8 encode + chunked send of the batch string. Shared by the
// onOpen flush path (which additionally enforces per-session backpressure)
// and the onClose/onError teardown paths (which don't — the socket is already
// closing, so triggering a PTY pause would just stall the teardown).
const sendOutputBatchBytes = (ws: BroadcastSocket, batch: string) => {
  if (!batch) return;
  const bytes = Buffer.from(batch, "utf8");
  if (bytes.byteLength <= MAX_OUTPUT_BYTES) {
    sendOutputBytes(ws, bytes);
  } else {
    for (let offset = 0; offset < bytes.byteLength; offset += MAX_OUTPUT_BYTES) {
      sendOutputBytes(ws, bytes.subarray(offset, offset + MAX_OUTPUT_BYTES));
    }
  }
};

// Git metadata is per-repo, not per-tab. Two tabs in the same cwd share one
// working tree, so a git-dirty signal from one tab — its shell's precmd OSC
// hook, or its fs watcher on .git — must refresh every tab in that cwd, not
// just the one whose shell produced the prompt. Without this, a git operation
// run inside one of two side-by-side tabs updates only that tab; the sibling
// stays stale until its own shell next renders a prompt (its precmd hook) or
// its fs watcher happens to surface the change. The summary is pathscoped to
// the cwd (`git diff` from a subdirectory lists only files under it), so the
// coordinator is keyed by cwd, not by repo — tabs in different subdirectories
// of the same repo get distinct summaries and never share.
//
// One coordinator per cwd also dedups the summary computation across concurrent
// signals from sibling tabs: their independent fs watchers and prompt hooks all
// funnel into a single in-flight pass (with one trailing pass after the burst
// settles), and the result is broadcast to every subscribed socket.
class GitDirtyCoordinator {
  private inFlight = false;
  private pending = false;
  private readonly subscribers = new Set<BroadcastSocket>();

  constructor(readonly cwd: string) {}

  add(socket: BroadcastSocket): void {
    this.subscribers.add(socket);
  }

  remove(socket: BroadcastSocket): void {
    this.subscribers.delete(socket);
  }

  get isEmpty(): boolean {
    return this.subscribers.size === 0;
  }

  signal(): void {
    if (this.inFlight) {
      this.pending = true;
      return;
    }
    this.inFlight = true;
    void this.run();
  }

  private readonly run = async (): Promise<void> => {
    try {
      // The working tree changed, so any cached full-diff pass for this cwd is
      // stale — drop it before re-reading the summary so the viewer's next
      // per-file fetch rebuilds against the new tree.
      invalidateGitDiffCache(this.cwd);
      const summary = await getGitDiffSummary(this.cwd);
      const payload: ServerToClientMessage = { type: "git-diff-summary", summary };
      for (const socket of this.subscribers) {
        safeSend(socket, payload);
      }
    } catch {
      /* transient git failure; the next signal retries */
    } finally {
      this.inFlight = false;
      if (this.pending) {
        this.pending = false;
        this.signal();
      }
    }
  };
}

export const createServer = async (options: ServerOptions = {}): Promise<RunningServer> => {
  const port = options.port ?? DEFAULT_PORT;
  const host = options.host ?? DEFAULT_HOST;

  const staticRoot =
    typeof options.staticRoot === "string" ? path.resolve(options.staticRoot) : null;

  const isLoopbackBind = isLoopbackHost(host);
  if (!isLoopbackBind) {
    console.warn(
      `⚠ non-loopback bind (${host}): any client on the private network can open an unauthenticated shell`,
    );
  }

  const registry = new SessionRegistry();
  // PTY reattach pool: a WS close (portless teardown on wake, transient drop)
  // parks the live Session here instead of killing it. The next WS open
  // carrying the matching `?sid=` reattaches; a grace timer disposes
  // abandoned PTYs whose client never comes back.
  const reattachPool = new SessionReattachPool({ graceMs: SESSION_GRACE_MS });
  const app = new Hono();
  app.use("*", createNetworkPolicyMiddleware(host));
  const { injectWebSocket, upgradeWebSocket, wss } = createNodeWebSocket({ app });
  wss.options.maxPayload = 256 * 1024;

  const stateDirectory = options.stateDirectory ?? path.join(os.homedir(), ".localterm");
  const automationStore = new AutomationStore(path.join(stateDirectory, "automations.json"));
  const automationRunTracker = new AutomationRunTracker();
  const automationScheduler = new AutomationScheduler(automationStore);
  // Folder-watch triggers: one fs.watch per watch automation's cwd (no polling).
  // isRunInFlight gates overlap (a launched/running latest run blocks a new
  // launch); getAutomation re-reads live state when the debounce fires.
  const folderWatchManager = new FolderWatchManager({
    debounceMs: AUTOMATION_WATCH_DEBOUNCE_MS,
    postRunGraceMs: AUTOMATION_WATCH_POST_RUN_GRACE_MS,
    isRunInFlight: (automationId) => {
      const status = automationStore.get(automationId)?.runs[0]?.status;
      return status === "launched" || status === "running";
    },
    getAutomation: (automationId) => automationStore.get(automationId),
  });
  const syncFolderWatchers = () => folderWatchManager.sync(automationStore.list());
  const sessionEventManager = new SessionEventManager({
    debounceMs: AUTOMATION_EVENT_DEBOUNCE_MS,
    postRunGraceMs: AUTOMATION_WATCH_POST_RUN_GRACE_MS,
    isRunInFlight: (automationId) => {
      const status = automationStore.get(automationId)?.runs[0]?.status;
      return status === "launched" || status === "running";
    },
    getAutomation: (automationId) => automationStore.get(automationId),
  });
  const syncSessionEventListeners = () => sessionEventManager.sync(automationStore.list());
  const heartbeatStore = new HeartbeatStore(path.join(stateDirectory, "daemon-heartbeat.json"));
  const caffeinateController = options.caffeinateController ?? new CaffeinateController();
  const caffeinatePreferencesStore = new CaffeinatePreferencesStore(
    path.join(stateDirectory, "caffeinate.json"),
  );
  const worktreeConfigStore = new WorktreeConfigStore(stateDirectory);
  const caffeinateManager = new CaffeinateManager({
    controller: caffeinateController,
    store: caffeinatePreferencesStore,
    listSessionPids: () => registry.pids(),
    snapshotProcesses: options.caffeinateSnapshotProcesses,
    batteryProbe: options.caffeinateBatteryProbe,
    hasRecentOutput: (pids, withinMs) => registry.hasRecentOutput(pids, withinMs),
  });
  const clientSockets = new Set<BroadcastSocket>();
  // One GitDirtyCoordinator per cwd, shared by every tab whose session is in
  // that cwd. A tab subscribes on open and resubscribes on every `cd`; a
  // git-dirty signal from any tab in the cwd broadcasts the recomputed summary
  // to all of them. Emptied coordinators are dropped so a cwd no tab is in
  // holds no watcher state.
  const gitDirtyCoordinatorsByCwd = new Map<string, GitDirtyCoordinator>();
  const coordinatorForCwd = (cwd: string): GitDirtyCoordinator => {
    const key = path.resolve(cwd);
    let coordinator = gitDirtyCoordinatorsByCwd.get(key);
    if (!coordinator) {
      coordinator = new GitDirtyCoordinator(key);
      gitDirtyCoordinatorsByCwd.set(key, coordinator);
    }
    return coordinator;
  };
  const releaseGitDirtyCoordinator = (coordinator: GitDirtyCoordinator): void => {
    if (coordinator.isEmpty) gitDirtyCoordinatorsByCwd.delete(coordinator.cwd);
  };
  const cdpBackgroundTabsDisabled = process.env.LOCALTERM_DISABLE_CDP_TABS === "1";
  // One persistent CDP socket for the daemon's lifetime — opened once at start
  // (below), so the user clears the browser's remote-debugging prompt a single
  // time rather than on every run. Skipped when a caller injects its own
  // `tabController` (it owns tab control) or when disabled via env.
  const cdpClient =
    options.tabController || cdpBackgroundTabsDisabled
      ? null
      : new CdpClient({
          // Only page-type targets on the daemon's own origin get an ambient token
          // injected — unrelated tabs the user has open in their debugged browser
          // stay untouched. `actualPort` is bound by the http server's listen
          // callback below; the filter is only invoked at targetCreated event
          // time (after CdpClient.connect, which runs after listen), so it reads
          // the resolved port rather than the pre-bind placeholder.
          tabUrlFilter: (candidateUrl: string) => isLocaltermTabUrl(candidateUrl, actualPort, host),
        });
  const tabController: AutomationTabController = options.tabController ?? {
    open: async (url: string) => {
      // Best case: if a debug-enabled Chromium browser is running, open the run
      // tab via CDP with `background: true` so it lands *behind* the active tab
      // (a true background tab, no focus steal) and stays closeable. This is how
      // browser-harness-js does it, over a connection we keep alive across runs.
      if (cdpClient) {
        const handle = await cdpClient.openBackgroundTab(url);
        if (handle) return handle;
      }
      // Fallback: the OS opener. `background: true` is macOS `open -g`, which at
      // least keeps the browser app from coming to the foreground; ignored
      // elsewhere. Used whenever CDP isn't available (non-Chromium default
      // browser, remote debugging off, or LOCALTERM_DISABLE_CDP_TABS=1). Not
      // closeable, so `closeOnFinish` is silently a no-op on this path.
      await open(url, { background: true });
      return null;
    },
    close: async (handle: string) => {
      if (cdpClient) await cdpClient.closeTab(handle);
    },
  };
  // Maps a run id -> the tab handle that ran it, so we can close the tab when
  // the command finishes (only set when the opener returned a closeable handle).
  const runTabHandles = new Map<string, string>();

  // Project the newest run as the legacy `lastRun` for back-compat clients.
  const deriveLastRun = (automation: Automation): AutomationLastRun | null => {
    const latest = automation.runs[0];
    if (!latest) return null;
    return {
      runId: latest.runId,
      at: latest.finishedAt ?? latest.startedAt ?? latest.scheduledFor,
      status: latest.status,
      exitCode: latest.exitCode,
    };
  };

  const toAutomationWithNextRun = (automation: Automation, from: Date): AutomationWithNextRun => ({
    ...automation,
    nextRunAt: computeNextAutomationRunAt(automation, from),
    cron:
      automation.trigger.kind === "schedule" ? compileSchedule(automation.trigger.schedule) : null,
    lastRun: deriveLastRun(automation),
  });

  const listAutomationsWithNextRun = (): AutomationWithNextRun[] => {
    const from = new Date();
    return automationStore.list().map((automation) => toAutomationWithNextRun(automation, from));
  };

  const broadcastAutomations = () => {
    const payload: ServerToClientMessage = {
      type: "automations",
      automations: listAutomationsWithNextRun(),
    };
    for (const clientSocket of clientSockets) {
      safeSend(clientSocket, payload);
    }
  };

  const caffeinateStatePayload = (): ServerToClientMessage => ({
    type: "caffeinate",
    supported: caffeinateManager.supported,
    active: caffeinateManager.active,
    mode: caffeinateManager.mode,
    activityGate: caffeinateManager.activityGate,
    batteryThreshold: caffeinateManager.batteryThreshold,
    defaultCommands: [...caffeinateManager.defaultCommands],
    commands: caffeinateManager.commands,
    activeTrigger: caffeinateManager.activeTrigger,
  });

  // The daemon owns the single keep-awake process, so its state is broadcast to
  // every tab — exactly like automations — and the coffee controls stay in sync.
  const broadcastCaffeinate = () => {
    const payload = caffeinateStatePayload();
    for (const clientSocket of clientSockets) {
      safeSend(clientSocket, payload);
    }
  };

  caffeinateManager.on("change", broadcastCaffeinate);

  // Open a browser tab for a run and record it in history. Scheduled and watch
  // launches count toward the limit (and can finish the automation); manual
  // launches never count and are allowed even on a finished/disabled automation.
  const tryLaunch = (
    automation: Automation,
    trigger: "schedule" | "manual" | "watch" | "event",
  ): PendingAutomationRun | null => {
    if (trigger !== "manual") {
      const current = automationStore.get(automation.id);
      if (!current || !current.enabled || current.lifecycle === "finished") return null;
    }
    const run = automationRunTracker.create(automation);
    const counts = trigger !== "manual";
    automationStore.appendRun(automation.id, {
      runId: run.runId,
      scheduledFor:
        trigger === "schedule"
          ? Math.floor(run.createdAt / MS_PER_MINUTE) * MS_PER_MINUTE
          : run.createdAt,
      startedAt: run.createdAt,
      finishedAt: null,
      status: "launched",
      exitCode: null,
      trigger,
      countsTowardLimit: counts,
    });
    if (counts) automationStore.incrementRunCount(automation.id);
    broadcastAutomations();
    // A watch automation that just reached its limit is now "finished"; stop
    // watching its folder promptly instead of waiting for the next mutation.
    syncFolderWatchers();
    syncSessionEventListeners();
    const runUrl = `http://${FRIENDLY_HOSTNAME}:${actualPort}/?run=${run.runId}`;
    void tabController
      .open(runUrl)
      .then((handle) => {
        // Remember the tab so `automation-exit` can close it if closeOnFinish.
        if (handle) runTabHandles.set(run.runId, handle);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `failed to open a browser tab for automation "${automation.name}": ${message}`,
        );
      });
    return run;
  };

  // Close a finished run's tab when the automation opted into closeOnFinish.
  const closeRunTabIfRequested = (automationId: string, runId: string): void => {
    const handle = runTabHandles.get(runId);
    runTabHandles.delete(runId);
    if (!handle) return;
    const automation = automationStore.get(automationId);
    if (!automation?.closeOnFinish) return;
    void tabController.close(handle).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`failed to close automation tab (run ${runId}): ${message}`);
    });
  };

  // On boot, settle the state the dead process left behind: any run still
  // "launched"/"running" can never resume (the run tracker is in-memory), so it
  // becomes "missed"; and if the daemon was down across scheduled times, record
  // those as "skipped" so the user can see what didn't run while the machine was
  // off. Skipped runs never launch and never count toward a limit. No clients
  // exist yet, so nothing is broadcast.
  const reconcileOnStartup = (now: number): void => {
    const lastAliveAt = heartbeatStore.read();
    const hadOutage =
      lastAliveAt !== null && now - lastAliveAt >= AUTOMATION_RECONCILE_MIN_DOWNTIME_MS;
    for (const automation of automationStore.list()) {
      for (const run of automation.runs) {
        if (run.status === "launched" || run.status === "running") {
          automationStore.updateRun(automation.id, run.runId, {
            status: "missed",
            finishedAt: now,
          });
        }
      }
      if (!hadOutage || !automation.enabled || automation.lifecycle === "finished") continue;
      for (const occurrence of enumerateMissedOccurrences(automation, lastAliveAt as number, now)) {
        automationStore.appendRun(automation.id, {
          runId: randomUUID(),
          scheduledFor: occurrence,
          startedAt: null,
          finishedAt: occurrence,
          status: "skipped",
          exitCode: null,
          trigger: "schedule",
          countsTowardLimit: false,
        });
      }
    }
  };

  const api = new Hono();
  api.get("/health", (context) => context.json({ ok: true, sessions: registry.size() }));

  // Same validation as the WS `?cwd=` param: must exist and be a directory.
  // No path containment check — this daemon already hands out unrestricted
  // shells, so reading a diff is not an escalation.
  const resolveCwdQuery = (rawCwd: string | undefined): string | null => {
    if (!rawCwd) return null;
    try {
      return fs.statSync(rawCwd).isDirectory() ? rawCwd : null;
    } catch {
      return null;
    }
  };

  api.get("/git/diff-summary", async (context) => {
    const cwd = resolveCwdQuery(context.req.query("cwd"));
    if (!cwd) return context.json({ error: "invalid_cwd" }, HTTP_STATUS_BAD_REQUEST);
    return context.json(await getGitDiffSummary(cwd));
  });

  // Repo-relative pathspec for the per-file diff. Reject absolute paths and any
  // `..` segment: the diff is read-only, but a traversal pathspec would just make
  // git return nothing useful, so fail fast with a clean 400 instead.
  const sanitizeDiffPath = (rawPath: string | undefined): string | null => {
    if (!rawPath) return null;
    if (rawPath.startsWith("/")) return null;
    if (rawPath.split("/").some((segment) => segment === "..")) return null;
    return rawPath;
  };

  // Base ref for "branch" mode. execFile never invokes a shell, so the only risk
  // is git interpreting the value as an option (leading "-") or a pathological
  // refname; reject those and anything outside a conservative refname charset. A
  // malformed base degrades to null so the server resolves its own default.
  const sanitizeRef = (rawRef: string | undefined): string | null => {
    if (!rawRef) return null;
    const ref = rawRef.trim();
    if (!ref || ref.length > GIT_MAX_REF_LENGTH) return null;
    if (ref.startsWith("-") || ref.includes("..")) return null;
    if (!/^[A-Za-z0-9._/+@-]+$/.test(ref)) return null;
    return ref;
  };

  // Diff comparison selector shared by the file-list and per-file endpoints. An
  // absent/invalid mode falls back to the always-available working-tree diff.
  const parseDiffOptions = (
    rawMode: string | undefined,
    rawBase: string | undefined,
  ): GitDiffOptions => ({
    mode: rawMode === "branch" ? "branch" : "working",
    base: sanitizeRef(rawBase),
  });

  api.get("/git/diff", async (context) => {
    const cwd = resolveCwdQuery(context.req.query("cwd"));
    if (!cwd) return context.json({ error: "invalid_cwd" }, HTTP_STATUS_BAD_REQUEST);
    const options = parseDiffOptions(context.req.query("mode"), context.req.query("base"));
    return context.json(await getGitDiff(cwd, options));
  });

  // File list without patch bodies — lets the viewer open instantly.
  api.get("/git/diff/files", async (context) => {
    const cwd = resolveCwdQuery(context.req.query("cwd"));
    if (!cwd) return context.json({ error: "invalid_cwd" }, HTTP_STATUS_BAD_REQUEST);
    const options = parseDiffOptions(context.req.query("mode"), context.req.query("base"));
    return context.json(await getGitDiffFiles(cwd, options));
  });

  // One file's patch, fetched lazily when that file is selected.
  api.get("/git/diff/file", async (context) => {
    const cwd = resolveCwdQuery(context.req.query("cwd"));
    if (!cwd) return context.json({ error: "invalid_cwd" }, HTTP_STATUS_BAD_REQUEST);
    const filePath = sanitizeDiffPath(context.req.query("path"));
    if (!filePath) return context.json({ error: "invalid_path" }, HTTP_STATUS_BAD_REQUEST);
    const options = parseDiffOptions(context.req.query("mode"), context.req.query("base"));
    return context.json(await getGitDiffFilePatch(cwd, filePath, options));
  });

  // Base-branch picker data for "branch" mode: candidate refs, a preselected
  // default, and the PR the branch maps to (via gh). Fetched once when the viewer
  // needs it — never polled.
  api.get("/git/branches", async (context) => {
    const cwd = resolveCwdQuery(context.req.query("cwd"));
    if (!cwd) return context.json({ error: "invalid_cwd" }, HTTP_STATUS_BAD_REQUEST);
    return context.json(await getGitBranchInfo(cwd));
  });

  // The PR lease for the current branch. Served separately from /git/branches so
  // the toolbar never blocks on the GitHub REST API; the client merges `pr` into
  // its branch-info lease once it resolves.
  api.get("/git/branches/pr", async (context) => {
    const cwd = resolveCwdQuery(context.req.query("cwd"));
    if (!cwd) return context.json({ error: "invalid_cwd" }, HTTP_STATUS_BAD_REQUEST);
    return context.json({ pr: await getGitBranchPr(cwd) });
  });

  const readJsonBody = async (context: { req: { json: () => Promise<unknown> } }) => {
    try {
      return await context.req.json();
    } catch {
      return undefined;
    }
  };

  // Resolve a worktree path (create target / remove target). Relative paths are
  // anchored to the caller's cwd so the client can pass a project-relative name;
  // absolute paths pass through. No traversal/containment check — the daemon
  // already hands out unrestricted shells, so creating a worktree elsewhere is
  // not an escalation.
  const resolveWorktreePath = (cwd: string, rawPath: string | undefined): string | null => {
    if (!rawPath) return null;
    const trimmed = rawPath.trim();
    if (!trimmed) return null;
    return path.resolve(cwd, trimmed);
  };

  const worktreeErrorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : "git operation failed";

  // Every worktree sharing the caller's repo. `git worktree list` returns the
  // whole linked set from any worktree, so this single read is the complete
  // project view — no store, no per-worktree tracking.
  api.get("/git/worktrees", async (context) => {
    const cwd = resolveCwdQuery(context.req.query("cwd"));
    if (!cwd) return context.json({ error: "invalid_cwd" }, HTTP_STATUS_BAD_REQUEST);
    try {
      return context.json(await listGitWorktrees(cwd));
    } catch (error) {
      return context.json(
        { error: "git_failed", message: worktreeErrorMessage(error) },
        HTTP_STATUS_BAD_REQUEST,
      );
    }
  });

  api.post("/git/worktrees", async (context) => {
    const cwd = resolveCwdQuery(context.req.query("cwd"));
    if (!cwd) return context.json({ error: "invalid_cwd" }, HTTP_STATUS_BAD_REQUEST);
    // An absent body (the modal `+`, the shortcut, the palette) creates a plain
    // worktree on the repo's configured base ref; a body opts into a PR or an
    // explicit base ref. The repo config supplies the base-ref default and the
    // setup script the client should run in the new tab.
    const parsed = createWorktreeInputSchema.safeParse(await readJsonBody(context));
    if (!parsed.success) {
      return context.json({ error: "invalid_body" }, HTTP_STATUS_BAD_REQUEST);
    }
    try {
      const config = await worktreeConfigStore.get(cwd);
      const baseRef = parsed.data.baseRef ?? config.baseRef;
      const result = await createGitWorktree(cwd, {
        baseRef,
        pullRequestNumber: parsed.data.pullRequestNumber,
      });
      return context.json(
        { ...result, setupCommand: config.setupScript || null },
        HTTP_STATUS_CREATED,
      );
    } catch (error) {
      return context.json(
        { error: "git_failed", message: worktreeErrorMessage(error) },
        HTTP_STATUS_BAD_REQUEST,
      );
    }
  });

  // Per-repo worktree config: the setup script, the "Open in…" launchers, and
  // the default base ref. Keyed server-side by repo id so it survives across
  // linked worktrees and is never committed to the repo.
  api.get("/git/worktrees/config", async (context) => {
    const cwd = resolveCwdQuery(context.req.query("cwd"));
    if (!cwd) return context.json({ error: "invalid_cwd" }, HTTP_STATUS_BAD_REQUEST);
    return context.json(await worktreeConfigStore.get(cwd));
  });

  api.put("/git/worktrees/config", async (context) => {
    const cwd = resolveCwdQuery(context.req.query("cwd"));
    if (!cwd) return context.json({ error: "invalid_cwd" }, HTTP_STATUS_BAD_REQUEST);
    const parsed = updateWorktreeConfigInputSchema.safeParse(await readJsonBody(context));
    if (!parsed.success) return context.json({ error: "invalid_body" }, HTTP_STATUS_BAD_REQUEST);
    return context.json(await worktreeConfigStore.update(cwd, parsed.data));
  });

  // Repo-root `.worktreeinclude` file: a gitignore-syntax allowlist of gitignored
  // files copied from the main worktree into each fresh worktree. Exposed so the
  // UI can show the current contents (or an empty editor when none exists) and
  // let the user create or update it.
  api.get("/git/worktrees/include-file", async (context) => {
    const cwd = resolveCwdQuery(context.req.query("cwd"));
    if (!cwd) return context.json({ error: "invalid_cwd" }, HTTP_STATUS_BAD_REQUEST);
    const file = await readWorktreeIncludeFile(cwd);
    if (!file) return context.json({ error: "not_a_git_repo" }, HTTP_STATUS_BAD_REQUEST);
    return context.json(file);
  });

  api.put("/git/worktrees/include-file", async (context) => {
    const cwd = resolveCwdQuery(context.req.query("cwd"));
    if (!cwd) return context.json({ error: "invalid_cwd" }, HTTP_STATUS_BAD_REQUEST);
    const parsed = worktreeIncludeFileInputSchema.safeParse(await readJsonBody(context));
    if (!parsed.success) return context.json({ error: "invalid_body" }, HTTP_STATUS_BAD_REQUEST);
    const file = await writeWorktreeIncludeFile(cwd, parsed.data.content);
    if (!file) return context.json({ error: "not_a_git_repo" }, HTTP_STATUS_BAD_REQUEST);
    return context.json(file);
  });

  // Remove stale, clean, auto-created worktrees older than the sweep threshold.
  // Never removes the current/main worktree or any the user made manually; a
  // dirty worktree is left untouched. Returns the paths removed. The branch
  // refs survive `git worktree remove`, so swept work is recoverable.
  api.post("/git/worktrees/sweep", async (context) => {
    const cwd = resolveCwdQuery(context.req.query("cwd"));
    if (!cwd) return context.json({ error: "invalid_cwd" }, HTTP_STATUS_BAD_REQUEST);
    try {
      return context.json(await sweepStaleWorktrees(cwd));
    } catch (error) {
      return context.json(
        { error: "git_failed", message: worktreeErrorMessage(error) },
        HTTP_STATUS_BAD_REQUEST,
      );
    }
  });

  // Launch an external command (an "Open in…" entry) detached in a worktree via
  // the user's login shell so rc-sourced PATH entries resolve. Fire-and-forget:
  // the daemon never waits on the launched process, and its output is discarded
  // (these are GUI launches like `code .`, `fork .`). The daemon already hands
  // out unrestricted shells, so running a user-configured command is not an
  // escalation.
  api.post("/launch", async (context) => {
    const parsed = launchInputSchema.safeParse(await readJsonBody(context));
    if (!parsed.success) return context.json({ error: "invalid_body" }, HTTP_STATUS_BAD_REQUEST);
    if (!resolveCwdQuery(parsed.data.cwd)) {
      return context.json({ error: "invalid_cwd" }, HTTP_STATUS_BAD_REQUEST);
    }
    try {
      const child = spawn(getDefaultShell(), ["-l", "-c", parsed.data.command], {
        cwd: parsed.data.cwd,
        detached: true,
        stdio: "ignore",
      });
      child.unref();
    } catch (error) {
      return context.json(
        { error: "launch_failed", message: worktreeErrorMessage(error) },
        HTTP_STATUS_BAD_REQUEST,
      );
    }
    return context.json({ ok: true });
  });

  api.delete("/git/worktrees", async (context) => {
    const cwd = resolveCwdQuery(context.req.query("cwd"));
    if (!cwd) return context.json({ error: "invalid_cwd" }, HTTP_STATUS_BAD_REQUEST);
    const targetPath = resolveWorktreePath(cwd, context.req.query("path"));
    if (!targetPath) return context.json({ error: "invalid_path" }, HTTP_STATUS_BAD_REQUEST);
    try {
      await removeGitWorktree(cwd, targetPath);
      return context.json({ ok: true });
    } catch (error) {
      return context.json(
        { error: "git_failed", message: worktreeErrorMessage(error) },
        HTTP_STATUS_BAD_REQUEST,
      );
    }
  });

  // A trigger is valid iff a schedule trigger compiles to ≥1 parseable cron;
  // watch and event triggers are always valid (their cwd is validated
  // separately).
  const isValidTriggerInput = (trigger: TriggerInput): boolean => {
    const normalized = normalizeTriggerInput(trigger);
    if (normalized.kind === "watch" || normalized.kind === "event") return true;
    const crons = compileScheduleAll(normalized.schedule);
    return crons.length > 0 && crons.every((cron) => parseCronExpression(cron) !== null);
  };

  api.get("/automations", (context) => context.json({ automations: listAutomationsWithNextRun() }));

  api.post("/automations", async (context) => {
    const parsed = createAutomationInputSchema.safeParse(await readJsonBody(context));
    if (!parsed.success) return context.json({ error: "invalid_body" }, HTTP_STATUS_BAD_REQUEST);
    if (automationStore.size() >= MAX_AUTOMATIONS) {
      return context.json({ error: "too_many_automations" }, HTTP_STATUS_BAD_REQUEST);
    }
    if (!isValidTriggerInput(parsed.data.trigger)) {
      return context.json({ error: "invalid_schedule" }, HTTP_STATUS_BAD_REQUEST);
    }
    if (!resolveCwdQuery(parsed.data.cwd)) {
      return context.json({ error: "invalid_cwd" }, HTTP_STATUS_BAD_REQUEST);
    }
    const automation = automationStore.create(parsed.data);
    broadcastAutomations();
    syncFolderWatchers();
    syncSessionEventListeners();
    return context.json(
      { automation: toAutomationWithNextRun(automation, new Date()) },
      HTTP_STATUS_CREATED,
    );
  });

  api.patch("/automations/:id", async (context) => {
    const parsed = updateAutomationInputSchema.safeParse(await readJsonBody(context));
    if (!parsed.success) return context.json({ error: "invalid_body" }, HTTP_STATUS_BAD_REQUEST);
    if (parsed.data.trigger !== undefined && !isValidTriggerInput(parsed.data.trigger)) {
      return context.json({ error: "invalid_schedule" }, HTTP_STATUS_BAD_REQUEST);
    }
    if (parsed.data.cwd !== undefined && !resolveCwdQuery(parsed.data.cwd)) {
      return context.json({ error: "invalid_cwd" }, HTTP_STATUS_BAD_REQUEST);
    }
    const existing = automationStore.get(context.req.param("id"));
    if (!existing) return context.json({ error: "not_found" }, HTTP_STATUS_NOT_FOUND);
    // A PATCH never un-finishes — re-enabling a finished automation must go
    // through reset so it can't accidentally fire past its limit.
    if (existing.lifecycle === "finished" && parsed.data.enabled === true) {
      return context.json({ error: "automation_finished" }, HTTP_STATUS_BAD_REQUEST);
    }
    const automation = automationStore.update(context.req.param("id"), parsed.data);
    if (!automation) return context.json({ error: "not_found" }, HTTP_STATUS_NOT_FOUND);
    broadcastAutomations();
    syncFolderWatchers();
    syncSessionEventListeners();
    return context.json({ automation: toAutomationWithNextRun(automation, new Date()) });
  });

  api.delete("/automations/:id", (context) => {
    if (!automationStore.remove(context.req.param("id"))) {
      return context.json({ error: "not_found" }, HTTP_STATUS_NOT_FOUND);
    }
    broadcastAutomations();
    syncFolderWatchers();
    syncSessionEventListeners();
    return context.json({ ok: true });
  });

  api.post("/automations/:id/run", (context) => {
    const automation = automationStore.get(context.req.param("id"));
    if (!automation) return context.json({ error: "not_found" }, HTTP_STATUS_NOT_FOUND);
    // tryLaunch only returns null for non-manual triggers (the finished/disabled
    // guard); a manual launch always succeeds. The guard satisfies the shared
    // nullable return type before reading run.runId.
    const run = tryLaunch(automation, "manual");
    if (!run) return context.json({ error: "launch_failed" }, HTTP_STATUS_BAD_REQUEST);
    return context.json({ runId: run.runId });
  });

  api.post("/automations/:id/reset", async (context) => {
    const parsed = resetAutomationInputSchema.safeParse((await readJsonBody(context)) ?? {});
    if (!parsed.success) return context.json({ error: "invalid_body" }, HTTP_STATUS_BAD_REQUEST);
    const automation = automationStore.reset(context.req.param("id"), parsed.data.clearHistory);
    if (!automation) return context.json({ error: "not_found" }, HTTP_STATUS_NOT_FOUND);
    broadcastAutomations();
    // Reset re-enables + reactivates; a watch automation resumes watching.
    syncFolderWatchers();
    syncSessionEventListeners();
    return context.json({ automation: toAutomationWithNextRun(automation, new Date()) });
  });

  api.notFound((context) => context.json({ error: "not_found" }, HTTP_STATUS_NOT_FOUND));
  app.route("/api", api);

  app.get(
    "/ws",
    upgradeWebSocket((context) => {
      let session: Session | null = null;
      let activeWs: BroadcastSocket | null = null;
      let claimedRunId: string | null = null;
      // Server-side id for the live PTY attached to this WS. Sent to the
      // client in the {type:"session"} message so a reconnect carries it back
      // as `?sid=` and the daemon reattaches the parked Session instead of
      // spawning a fresh shell. Cleared on genuine shell exit (no reattach).
      let sessionId: string | null = null;
      // Persisted across park/reattach so onClose/onError can re-park the
      // automation-run context (the run-tracker claim is single-use, so we
      // can't re-derive automationId/runId from `?run=` on reconnect).
      let automationId: string | null = null;
      // The CDP targetId this WS socket was paired with via the
      // `{type:"identify"}` handshake (page's ambient token →
      // CdpClient.findTargetIdForToken). Set on identify; drives closeTab on
      // clean shell exit. Stays null when no CDP is reachable, the token raced
      // (page opened before the CdpClient observed it), or the page never
      // re-identified.
      let claimedTargetId: string | null = null;
      // The per-cwd git-dirty coordinator this socket is currently subscribed
      // to. Lives in this outer scope (not onOpen's) so the shared
      // `releaseSessionFromSocket` finalization — called by both onClose and
      // onError — can unsubscribe it. Moves whenever the session's cwd changes.
      let gitDirtyCoordinator: GitDirtyCoordinator | null = null;
      let drainPollTimer: NodeJS.Timeout | null = null;
      let heartbeatTimer: NodeJS.Timeout | null = null;
      let stopHeartbeat: (() => void) | null = null;
      let outputBatch = "";
      let outputBatchTimer: NodeJS.Timeout | null = null;

      const stopDrainPoll = () => {
        if (drainPollTimer === null) return;
        clearInterval(drainPollTimer);
        drainPollTimer = null;
      };

      const stopHeartbeatChecks = () => {
        if (heartbeatTimer !== null) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
        if (stopHeartbeat) {
          stopHeartbeat();
          stopHeartbeat = null;
        }
      };

      // Drop any unclosed tab handle for this connection's run so the map can't
      // grow without bound when a tab closes before its command reports exit
      // (non-bash shells, or the user closing the tab early).
      const releaseRunTabHandle = () => {
        if (claimedRunId) {
          runTabHandles.delete(claimedRunId);
          claimedRunId = null;
        }
      };
      // Single-shot finalization shared by onClose/onError (ws fires error then
      // close on a transport failure; without this guard both would try to
      // dispose/park the same Session). Parks a still-live PTY behind `sid` so
      // a reconnecting client with `?sid=` can reattach; disposes on genuine
      // shell exit, when no sid was minted, or when the session is already
      // gone.
      let sessionFinalized = false;
      const releaseSessionFromSocket = () => {
        if (sessionFinalized) return;
        if (!session) return;
        sessionFinalized = true;
        const live = session;
        registry.unregister(live);
        caffeinateManager.pokeAuto();
        if (!live.isExited && sessionId) {
          reattachPool.park(live, {
            sid: sessionId,
            claimedRunId,
            claimedTargetId,
            automationId,
          });
        } else {
          live.dispose();
        }
        // Unsubscribe from the per-cwd git-dirty coordinator so a closed
        // tab stops receiving (and stops keeping alive) broadcasts for its
        // former cwd. `activeWs` is the socket this coordinator was added
        // under; it's nulled below, so capture it first.
        if (gitDirtyCoordinator && activeWs) {
          gitDirtyCoordinator.remove(activeWs);
          releaseGitDirtyCoordinator(gitDirtyCoordinator);
          gitDirtyCoordinator = null;
        }
        session = null;
        activeWs = null;
      };

      const rawCwd = context.req.query("cwd");
      let requestedCwd: string | undefined;
      if (rawCwd) {
        try {
          const stat = fs.statSync(rawCwd);
          if (stat.isDirectory()) requestedCwd = rawCwd;
        } catch {
          /* invalid or inaccessible path; fall back to default cwd */
        }
      }
      const requestedRunId = context.req.query("run");
      const requestedSid = context.req.query(SESSION_ID_QUERY_PARAM) ?? null;
      // A plain tab may carry an initial command (a worktree's setup script) —
      // distinct from an automation run (`?run=`), which still takes precedence
      // when both are present. The command is written to the PTY as if the user
      // typed it, so its output is visible and the shell prompt returns after.
      const requestedInitialCommand = context.req.query("cmd") ?? undefined;

      return {
        onOpen(_event, ws) {
          activeWs = ws;
          if (!isLoopbackBind) {
            const remoteAddress = extractRemoteAddress(ws.raw);
            if (remoteAddress && !isAllowedSourceIp(remoteAddress, host)) {
              ws.close(WS_CLOSE_POLICY_VIOLATION, "source IP not allowed");
              return;
            }
          }
          if (registry.size() >= MAX_CONCURRENT_SESSIONS) {
            ws.close(WS_CLOSE_CAPACITY_REACHED, "session capacity reached");
            return;
          }
          clientSockets.add(ws);
          // Claims are single-use: a reload of a ?run= tab gets a plain shell
          // in the same cwd instead of re-running the scheduled command.
          const claimedRun = requestedRunId ? automationRunTracker.claim(requestedRunId) : null;
          if (claimedRun) claimedRunId = claimedRun.runId;
          // Reattach: if the WS carries a `?sid=` for a PTY the pool still has
          // parked (transient drop — portless teardown on wake, brief network
          // blip), rebind the live Session to this socket instead of spawning
          // a new shell. A `claim()` miss (grace expired, or shell exited while
          // parked) falls through to the spawn path.
          const parked = requestedSid ? reattachPool.claim(requestedSid) : null;
          const isReattach = parked !== null;
          let liveSession: Session;
          if (parked) {
            liveSession = parked.session;
            sessionId = parked.sid;
            claimedRunId = parked.claimedRunId;
            claimedTargetId = parked.claimedTargetId;
            automationId = parked.automationId;
            // Re-register so the live PTY counts toward MAX_CONCURRENT_SESSIONS
            // and caffeinate's ps-tree walk again. park() unregistered it on
            // the prior WS close; if we skipped this, a transient drop would
            // leave the PTY off the books until the next reconnect.
            registry.register(liveSession);
          } else {
            let sessionCwd = requestedCwd;
            if (claimedRun) {
              try {
                if (fs.statSync(claimedRun.cwd).isDirectory()) sessionCwd = claimedRun.cwd;
              } catch {
                /* automation cwd vanished since creation; fall back to default */
              }
            }
            const freshSession = new Session({
              cwd: sessionCwd,
              initialCommand: claimedRun?.command ?? requestedInitialCommand,
            });
            liveSession = freshSession;
            sessionId = generateSessionId();
            if (claimedRun) automationId = claimedRun.automationId;
            registry.register(freshSession);
          }
          session = liveSession;

          const automationRunId = claimedRunId;
          const isAutomationSession = automationId !== null;
          if (isAutomationSession && !isReattach) {
            automationStore.updateRun(automationId as string, automationRunId as string, {
              status: "running",
              startedAt: Date.now(),
            });
            broadcastAutomations();
          }
          if (isAutomationSession) {
            liveSession.on("automation-exit", (exitCode: number) => {
              automationStore.updateRun(automationId as string, automationRunId as string, {
                status: exitCode === 0 ? "completed" : "failed",
                exitCode,
                finishedAt: Date.now(),
              });
              broadcastAutomations();
              closeRunTabIfRequested(automationId as string, automationRunId as string);
              folderWatchManager.notifyRunFinished(automationId as string);
              sessionEventManager.notifyRunFinished(automationId as string);
            });
          }

          // Heartbeat. Without this, half-open sockets (laptop sleep, network
          // dropout) never surface as a `close` event and the daemon keeps
          // streaming PTY output into the void. We only enable it if the raw
          // socket exposes `on("pong")` — otherwise the timer would tick with
          // no pongs ever observed and kill healthy connections after the
          // first idle window.
          //
          // Stale-`lastPongAt` recovery: when the interval fires past the idle
          // threshold (the common post-wake case — `Date.now()` advanced during
          // sleep but the loopback socket itself never dropped), we send one
          // fresh ping and wait through WS_HEARTBEAT_GRACE_MS for a pong before
          // terminating. A live socket pongs inside the grace window; a truly
          // half-open one stays silent and terminates on the next tick. This
          // avoids killing sessions that survived a brief laptop sleep, while
          // still tearing down genuinely dead sockets within ~one extra tick.
          let lastPongAt = Date.now();
          let pendingPingAt = 0;
          stopHeartbeat = onRawEvent(ws.raw, "pong", () => {
            lastPongAt = Date.now();
            pendingPingAt = 0;
          });
          if (stopHeartbeat) {
            heartbeatTimer = setInterval(() => {
              if (ws.readyState !== WS_READY_STATE_OPEN) return;
              const idleMs = Date.now() - lastPongAt;
              if (idleMs > WS_HEARTBEAT_TIMEOUT_MS) {
                if (pendingPingAt === 0) {
                  pendingPingAt = Date.now();
                  callRawMethod(ws.raw, "ping");
                  return;
                }
                const pingPendingMs = Date.now() - pendingPingAt;
                if (pingPendingMs < WS_HEARTBEAT_GRACE_MS) return;
                console.warn(
                  `ws heartbeat timeout: no pong for ${idleMs}ms (grace ${pingPendingMs}ms, pid ${liveSession.pid}); terminating`,
                );
                stopHeartbeatChecks();
                if (!callRawMethod(ws.raw, "terminate")) ws.close();
                return;
              }
              callRawMethod(ws.raw, "ping");
            }, WS_HEARTBEAT_INTERVAL_MS);
            heartbeatTimer.unref?.();
          }

          // Outbound flow control. When the WS buffer climbs past the high
          // water mark we pause the PTY (OS pipe back-pressure stops the
          // child process producing more output) and start polling for the
          // buffer to drain back below the low water mark. This way bursty
          // output (`cat`, build logs, npm install) doesn't kill the
          // connection — only a genuinely wedged receiver eventually trips
          // the WS_BACKPRESSURE_THRESHOLD_BYTES emergency in safeSend.
          const ensureDrainPoll = () => {
            if (drainPollTimer !== null) return;
            drainPollTimer = setInterval(() => {
              if (!liveSession.isPaused) {
                stopDrainPoll();
                return;
              }
              if (getRawBufferedAmount(ws.raw) <= WS_OUTBOUND_RESUME_LOW_WATER_BYTES) {
                liveSession.resume();
                stopDrainPoll();
              }
            }, WS_OUTBOUND_DRAIN_POLL_MS);
            drainPollTimer.unref?.();
          };

          // Drain-and-pause for the timer-driven and threshold flushes; the per-
          // session backpressure pause check lives here (and only here — the
          // onClose/onError teardown paths skip it via sendOutputBatchBytes
          // directly).
          const drainOutputBatch = (target: BroadcastSocket) => {
            sendOutputBatchBytes(target, outputBatch);
            outputBatch = "";
            if (
              !liveSession.isPaused &&
              getRawBufferedAmount(target.raw) >= WS_OUTBOUND_PAUSE_HIGH_WATER_BYTES
            ) {
              liveSession.pause();
              ensureDrainPoll();
            }
          };

          const flushOutputBatch = () => {
            outputBatchTimer = null;
            drainOutputBatch(ws);
          };

          // Wire listeners so any emit from Session (current or future)
          // reaches the client. Today node-pty's data/exit are async, but
          // this guards against drift.
          const onOutput = (data: string) => {
            outputBatch += data;
            registry.noteOutput(liveSession.pid);
            caffeinateManager.noteOutputActivity();
            if (outputBatch.length >= OUTPUT_BATCH_FLUSH_BYTES) {
              if (outputBatchTimer !== null) {
                clearTimeout(outputBatchTimer);
                outputBatchTimer = null;
              }
              flushOutputBatch();
            } else if (outputBatchTimer === null) {
              outputBatchTimer = setTimeout(flushOutputBatch, OUTPUT_BATCH_WINDOW_MS);
            }
          };
          const onTitle = (title: string) => safeSend(ws, { type: "title", title });
          const onCwd = (cwd: string) => safeSend(ws, { type: "cwd", cwd });
          const onForeground = (process: string | null) => {
            safeSend(ws, { type: "foreground", process });
            // A foreground transition is the cheap signal that a recognized
            // program may have started or stopped — nudge automatic detection.
            caffeinateManager.pokeAuto();
          };
          const onNotification = (body: string) => safeSend(ws, { type: "notification", body });
          const onExit = (code: number | null) => {
            // Reliable closeTab on a clean shell exit for CDP-controlled tabs.
            // closeTab drives the browser's own close path via CDP instead of
            // relying on the client's window.close() — which often doesn't
            // apply (Dia/Arc, or a tab the user opened by URL rather than via
            // window.open) and strands the tab. Fire-and-forget onto the same
            // closeQueue that serializes automation-run closes, so concurrent
            // Ctrl+Ds across tabs never interleave and orphan targets.
            // Skipped on non-zero exit codes so the dead-session mask surfaces
            // the failure instead of closing the tab silently.
            if (claimedTargetId && (code === null || code === 0)) {
              void cdpClient?.closeTab(claimedTargetId);
            }
            if (outputBatchTimer !== null) {
              clearTimeout(outputBatchTimer);
              outputBatchTimer = null;
            }
            flushOutputBatch();
            stopDrainPoll();
            stopHeartbeatChecks();
            gitDiffWatcher.dispose();
            safeSend(ws, { type: "exit", code });
            ws.close();
          };

          const gitDiffWatcher = new GitDiffWatcher();
          // Subscribe this tab to the per-cwd git-dirty coordinator so a git
          // change observed by any tab in the same cwd (its prompt hook or fs
          // watcher) refreshes this tab too. The coordinator dedups the
          // summary computation and broadcasts the result to every subscriber.
          gitDirtyCoordinator = coordinatorForCwd(liveSession.cwd);
          gitDirtyCoordinator.add(ws);
          const signalGitDirty = (): void => {
            const cwd = liveSession.lastEmittedCwd;
            if (!cwd) return;
            coordinatorForCwd(cwd).signal();
          };

          gitDiffWatcher.on("git-dirty", () => {
            signalGitDirty();
          });
          const gitAutomationEvents: GitRefEventName[] = GIT_DIFF_WATCHER_EVENT_NAMES.filter(
            (eventName): eventName is GitRefEventName => eventName !== "git-dirty",
          );
          for (const eventName of gitAutomationEvents) {
            gitDiffWatcher.on(eventName, () => {
              if (!isAutomationSession) {
                sessionEventManager.onSessionEvent(eventName, liveSession.lastEmittedCwd);
              }
            });
          }
          gitDiffWatcher.start(liveSession.cwd);

          // Automation-run sessions should not feed events into the session
          // event manager — only user-driven sessions count.
          liveSession.on("git-dirty", () => {
            signalGitDirty();
            if (!isAutomationSession) {
              sessionEventManager.onSessionEvent("git-dirty", liveSession.lastEmittedCwd);
            }
          });
          liveSession.on("cwd", (changedCwd: string) => {
            gitDiffWatcher.stop();
            gitDiffWatcher.start(changedCwd);
            const nextCoordinator = coordinatorForCwd(changedCwd);
            const current = gitDirtyCoordinator;
            if (current && nextCoordinator !== current) {
              current.remove(ws);
              releaseGitDirtyCoordinator(current);
              gitDirtyCoordinator = nextCoordinator;
              nextCoordinator.add(ws);
            }
            if (!isAutomationSession) {
              sessionEventManager.onSessionEvent("cwd", changedCwd);
            }
          });

          liveSession.on("output", onOutput);
          liveSession.on("title", onTitle);
          liveSession.on("cwd", onCwd);
          liveSession.on("foreground", (foregroundProcess: string | null) => {
            onForeground(foregroundProcess);
            if (!isAutomationSession) {
              sessionEventManager.onSessionEvent("foreground", liveSession.lastEmittedCwd);
            }
          });
          liveSession.on("notification", (body: string) => {
            onNotification(body);
            if (!isAutomationSession) {
              sessionEventManager.onSessionEvent("notification", liveSession.lastEmittedCwd);
            }
          });
          liveSession.on("exit", (code: number | null) => {
            onExit(code);
            if (!isAutomationSession && liveSession.lastEmittedCwd) {
              sessionEventManager.onSessionEvent("exit", liveSession.lastEmittedCwd);
            }
          });

          safeSend(ws, {
            type: "session",
            shell: liveSession.shell,
            shellName: liveSession.shellBaseName,
            pid: liveSession.pid,
            cwd: liveSession.lastEmittedCwd || liveSession.cwd,
            title: liveSession.initialDocumentTitle,
            id: sessionId ?? undefined,
          });
          // Tell this tab the current keep-awake state so its coffee toggle
          // renders correctly (and is hidden where caffeinate is unsupported).
          safeSend(ws, caffeinateStatePayload());
        },
        onMessage(event) {
          if (!session) return;
          let rawPayload: unknown;
          try {
            const raw = typeof event.data === "string" ? event.data : event.data.toString();
            rawPayload = JSON.parse(raw);
          } catch {
            return;
          }
          const parsed = clientToServerMessageSchema.safeParse(rawPayload);
          if (!parsed.success) return;
          if (parsed.data.type === "input") {
            session.write(parsed.data.data);
          } else if (parsed.data.type === "caffeinate-mode") {
            caffeinateManager.setMode(parsed.data.mode);
          } else if (parsed.data.type === "caffeinate-commands") {
            caffeinateManager.setCommands(parsed.data.commands);
          } else if (parsed.data.type === "caffeinate-activity-gate") {
            caffeinateManager.setActivityGate(parsed.data.enabled);
          } else if (parsed.data.type === "caffeinate-battery-threshold") {
            caffeinateManager.setBatteryThreshold(parsed.data.percent);
          } else if (parsed.data.type === "identify") {
            // Ambient tab provenance: the page echoes the CDP-injected token so
            // we pair this socket with its targetId for closeTab on shell exit.
            // `token:null` means injection hasn't landed yet (page opened its
            // WS before the CdpClient observed it) — wait for the page to
            // re-identify on the 'localterm-token' event rather than pairing
            // eagerly against a null token. We always ack the client either
            // way so its markShellDead path knows whether to fall back to
            // window.close() or wait for the CDP-driven close.
            const token = parsed.data.token;
            if (token !== null) {
              const targetId = cdpClient?.findTargetIdForToken(token);
              if (targetId) claimedTargetId = targetId;
            }
            if (activeWs) {
              safeSend(activeWs, {
                type: "cdp-controlled",
                controlled: claimedTargetId !== null,
              });
            }
          } else {
            session.resize(
              parsed.data.cols,
              parsed.data.rows,
              parsed.data.pixelWidth,
              parsed.data.pixelHeight,
            );
          }
        },
        onClose(event) {
          if (outputBatchTimer !== null) {
            clearTimeout(outputBatchTimer);
            outputBatchTimer = null;
          }
          if (outputBatch && activeWs) {
            sendOutputBatchBytes(activeWs, outputBatch);
            outputBatch = "";
          }
          stopDrainPoll();
          stopHeartbeatChecks();
          // Most "the terminal randomly died" reports are actually the WS
          // closing for a reason we never surfaced; logging code+reason+
          // wasClean here makes the next incident a 1-line lookup in
          // ~/.localterm/server.log.
          const pidLabel = session ? ` pid ${session.pid}` : "";
          console.info(
            `ws closed${pidLabel}: code=${event.code} reason=${JSON.stringify(event.reason)} wasClean=${event.wasClean}`,
          );
          if (activeWs) clientSockets.delete(activeWs);
          releaseRunTabHandle();
          releaseSessionFromSocket();
        },
        onError(event) {
          if (outputBatchTimer !== null) {
            clearTimeout(outputBatchTimer);
            outputBatchTimer = null;
          }
          if (outputBatch && activeWs) {
            sendOutputBatchBytes(activeWs, outputBatch);
            outputBatch = "";
          }
          stopDrainPoll();
          stopHeartbeatChecks();
          const errorValue =
            event && typeof event === "object" ? (Reflect.get(event, "error") ?? event) : event;
          const message = errorValue instanceof Error ? errorValue.message : String(errorValue);
          const pidLabel = session ? ` pid ${session.pid}` : "";
          console.error(`ws error${pidLabel}: ${message}`);
          if (activeWs) clientSockets.delete(activeWs);
          releaseRunTabHandle();
          releaseSessionFromSocket();
        },
      };
    }),
  );

  if (staticRoot) {
    app.get("*", (context) => {
      const requestPath = context.req.path;
      if (requestPath.startsWith("/api/") || requestPath.startsWith("/ws")) {
        return context.json({ error: "not_found" }, HTTP_STATUS_NOT_FOUND);
      }
      const asset = resolveStaticAsset(staticRoot, requestPath);
      if (!asset) return context.text("not found", HTTP_STATUS_NOT_FOUND);
      return new Response(new Uint8Array(asset.body), {
        status: asset.status,
        headers: { "content-type": asset.contentType },
      });
    });
  }

  let httpServer: ServerType | null = null;
  let actualPort = port;
  await new Promise<void>((resolve, reject) => {
    const handleError = (error: Error) => {
      reject(new ServerErrorException(serverError.listenFailed(host, port, error)));
    };
    const node = serve(
      {
        fetch: app.fetch,
        hostname: host,
        port,
      },
      () => {
        const addr = node.address();
        if (addr && typeof addr === "object") actualPort = addr.port;
        node.removeListener("error", handleError);
        node.on("error", (error: Error) => {
          console.error(`http server error: ${error.message}`);
        });
        resolve();
      },
    );
    node.once("error", handleError);
    httpServer = node;
  });
  if (!httpServer) {
    throw new ServerErrorException(
      serverError.listenFailed(
        host,
        port,
        new Error("hono serve() resolved without binding an http server"),
      ),
    );
  }
  injectWebSocket(httpServer);

  automationScheduler.on("due", (automation) => {
    tryLaunch(automation, "schedule");
  });
  folderWatchManager.on("due", (automation) => {
    tryLaunch(automation, "watch");
  });
  sessionEventManager.on("due", (automation) => {
    tryLaunch(automation, "event");
  });
  automationScheduler.on("tick", (now) => {
    // Liveness heartbeat for downtime detection on the next boot.
    heartbeatStore.write(now.getTime());
    let didExpireAny = false;
    for (const expiredRun of automationRunTracker.sweepExpired(now.getTime())) {
      const automation = automationStore.get(expiredRun.automationId);
      const run = automation?.runs.find((entry) => entry.runId === expiredRun.runId);
      if (!automation || !run || run.status !== "launched") continue;
      automationStore.updateRun(automation.id, run.runId, {
        status: "missed",
        finishedAt: now.getTime(),
      });
      didExpireAny = true;
    }
    if (didExpireAny) broadcastAutomations();
  });
  reconcileOnStartup(Date.now());
  automationScheduler.start();
  // Arm folder-watch triggers for the automations loaded at boot.
  syncFolderWatchers();
  syncSessionEventListeners();

  // Open the persistent CDP connection now, while the user is present at
  // `start` to clear any one-time remote-debugging prompt. Fire-and-forget:
  // failure just means runs fall back to the OS opener.
  if (cdpClient) {
    void cdpClient
      .connect()
      .then(() => {
        if (cdpClient.connectedBrowser) {
          console.log(
            `automation run tabs will open in the background via ${cdpClient.connectedBrowser.name} (CDP)`,
          );
        }
      })
      .catch(() => {
        // No debug-enabled Chromium browser reachable — runs use `open -g`.
      });
  }

  const stop = async () => {
    automationScheduler.dispose();
    folderWatchManager.dispose();
    caffeinateManager.dispose();
    cdpClient?.close();
    registry.disposeAll();
    reattachPool.disposeAll();
    // Forcibly tear down every WS first. node-pty + ws upgraded sockets
    // aren't tracked in http.Server's keep-alive set, so target.close() would
    // otherwise wait forever for them and the CLI's force-exit fallback would
    // fire on every shutdown.
    for (const client of wss.clients) {
      try {
        client.terminate();
      } catch {
        /* socket already torn down */
      }
    }
    try {
      wss.close();
    } catch {
      /* idempotent close — wss may already be closed */
    }
    if (!httpServer) return;
    const target = httpServer;
    const closeAllConnections = Reflect.get(target, "closeAllConnections");
    if (typeof closeAllConnections === "function") {
      closeAllConnections.call(target);
    }
    await new Promise<void>((resolve) => {
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const grace = setTimeout(settle, SERVER_STOP_GRACE_MS);
      grace.unref?.();
      target.close(() => {
        clearTimeout(grace);
        settle();
      });
    });
  };

  return { port: actualPort, host, registry, stop };
};

export type { Session } from "./session.js";
export type { SessionRegistry } from "./session-registry.js";
export { CaffeinateController } from "./caffeinate-controller.js";
export type {
  CaffeinateControllerOptions,
  CaffeinateProcessHandle,
} from "./caffeinate-controller.js";
export type * from "./types.js";
export { DEFAULT_HOST, DEFAULT_PORT, WS_CLOSE_BACKPRESSURE } from "./constants.js";
export { isLoopbackHost, isPrivateHost, isAllowedSourceIp } from "./security.js";
export { healthSchema } from "./schemas.js";
export {
  ServerErrorException,
  formatServerError,
  isServerErrorException,
  serverError,
} from "./errors.js";
export type { ServerError, ServerErrorCode, ServerErrorKind } from "./errors.js";
