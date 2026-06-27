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
import type { DetectedBrowser } from "./cdp/detect-chromium.js";
import {
  AUTOMATION_EVENT_DEBOUNCE_MS,
  AUTOMATION_RECONCILE_MIN_DOWNTIME_MS,
  AUTOMATION_RUN_QUERY_PARAM,
  AUTOMATION_WATCH_DEBOUNCE_MS,
  AUTOMATION_WATCH_POST_RUN_GRACE_MS,
  AUTOMATION_WEBHOOK_DEBOUNCE_MS,
  DEFAULT_HOST,
  DEFAULT_PORT,
  FRIENDLY_HOSTNAME,
  GIT_MAX_REF_LENGTH,
  HTTP_STATUS_ACCEPTED,
  HTTP_STATUS_BAD_REQUEST,
  HTTP_STATUS_CONFLICT,
  HTTP_STATUS_CREATED,
  HTTP_STATUS_NOT_FOUND,
  MAX_AUTOMATIONS,
  MS_PER_MINUTE,
  SERVER_STOP_GRACE_MS,
  SESSION_ID_QUERY_PARAM,
  WS_BACKPRESSURE_THRESHOLD_BYTES,
  WS_CLOSE_BACKPRESSURE,
  WS_CLOSE_CAPACITY_REACHED,
  WS_CLOSE_POLICY_VIOLATION,
  WS_HEARTBEAT_GRACE_MS,
  WS_HEARTBEAT_INTERVAL_MS,
  WS_HEARTBEAT_TIMEOUT_MS,
  WS_READY_STATE_OPEN,
} from "./constants.js";
import { getDefaultShell } from "./default-shell.js";
import { shellPathForUserShell } from "./utils/shell-path.js";
import { ServerErrorException, serverError } from "./errors.js";
import { FolderWatchManager } from "./folder-watch-manager.js";
import { SessionEventManager } from "./session-event-manager.js";
import { WebhookTriggerManager } from "./webhook-trigger-manager.js";
import {
  getGitBranchInfo,
  getGitBranchPr,
  getGitDiff,
  getGitDiffFilePatch,
  getGitDiffFiles,
  getGitDiffSummary,
  type GitDiffOptions,
} from "./git-diff.js";
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
import { createNetworkPolicyMiddleware, isAllowedSourceIp, isLoopbackHost } from "./security.js";
import { SessionManager, type AutomationContext, type ManagedSession } from "./session-manager.js";
import { getBufferedAmount, type ClientSocket } from "./utils/ws-socket.js";
import { resolveStaticAsset } from "./static-resolver.js";
import { resolveImageAsset } from "./utils/resolve-image-asset.js";
import { sweepStaleWorktrees } from "./utils/worktree-sweep.js";
import {
  readWorktreeIncludeFile,
  writeWorktreeIncludeFile,
} from "./utils/worktree-include-file.js";
import { WorktreeConfigStore } from "./worktree-config-store.js";
import { compileSchedule, compileScheduleAll } from "./utils/compile-schedule.js";
import { computeNextAutomationRunAt } from "./utils/compute-next-automation-run-at.js";
import { isLocaltermTabUrl } from "./utils/is-localterm-tab-url.js";
import { normalizeTriggerInput } from "./utils/normalize-trigger.js";
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
   * The announced surface origin automation-run tabs should open at — the URL
   * the CLI resolved best-first (tailnet `https://<node>.ts.net`, portless
   * `https://localterm.localhost`, or null for the bare loopback form). When
   * set, `tryLaunch` opens run tabs at this origin instead of the hardcoded
   * loopback `http://<friendly>:<port>`, and the CDP tab filter recognises it
   * so ambient-token injection and `closeOnFinish` keep working behind the
   * proxy. Updatable post-bind via `RunningServer.setPublicUrl` since the
   * bound port (and thus the loopback fallback) isn't known until `listen`.
   */
  publicUrl?: string | null;
  /**
   * Override how automation run tabs are opened and closed. When provided, the
   * caller owns tab control and the built-in CDP background-tab path is
   * disabled. Defaults to: CDP background tab (closeable) when a debug-enabled
   * Chromium browser is reachable, else the OS opener (`open -g`, not
   * closeable).
   */
  tabController?: AutomationTabController;
  /**
   * Override how the daemon's persistent CDP client discovers debug-enabled
   * Chromium browsers. Defaults to scanning known user-data dirs for a live
   * DevToolsActivePort. Injectable so tests can drive the health endpoint's
   * `cdp` field deterministically without a real browser on the machine.
   */
  cdpDetect?: () => Promise<DetectedBrowser[]>;
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
  registry: SessionManager;
  /**
   * Update the announced surface origin automation-run tabs open at. Called by
   * the CLI once it has resolved the best surface from the bound port (tailnet
   * / portless / loopback); null resets to the loopback default.
   */
  setPublicUrl: (url: string | null) => void;
  stop: () => Promise<void>;
}

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

const safeSend = (ws: ClientSocket, payload: ServerToClientMessage) => {
  if (ws.readyState !== WS_READY_STATE_OPEN) return;
  if (getBufferedAmount(ws) > WS_BACKPRESSURE_THRESHOLD_BYTES) {
    ws.close(WS_CLOSE_BACKPRESSURE, "backpressure");
    return;
  }
  try {
    ws.send(JSON.stringify(payload));
  } catch {
    /* socket closed between readyState check and send */
  }
};

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

  // The session manager owns every live PTY for the daemon's lifetime. A PTY
  // persists across client detach (closing a tab detaches instead of killing
  // it) so the session picker can re-attach to it; it dies on shell exit, an
  // explicit kill from the picker, or the dormant-idle sweep. Multiple clients
  // may attach to one PTY and fan out output/resize to all of them. The hooks
  // close over managers defined further below; they only fire at runtime
  // (attach/detach/output/exit), so referencing the later consts here is safe.
  const registry = new SessionManager({
    sendControl: safeSend,
    hooks: {
      onOutputActivity: () => caffeinateManager.noteOutputActivity(),
      onSessionActivity: () => caffeinateManager.pokeAuto(),
      onSessionEvent: (event, cwd) => sessionEventManager.onSessionEvent(event, cwd),
      onAutomationExit: (automationId, runId, exitCode) => {
        automationStore.updateRun(automationId, runId, {
          status: exitCode === 0 ? "completed" : "failed",
          exitCode,
          finishedAt: Date.now(),
        });
        broadcastAutomations();
        closeRunTabIfRequested(automationId, runId);
        folderWatchManager.notifyRunFinished(automationId);
        sessionEventManager.notifyRunFinished(automationId);
      },
      onClientExit: (ws, exitCode) => {
        const targetId = wsToTargetId.get(ws);
        if (targetId && (exitCode === null || exitCode === 0)) void cdpClient?.closeTab(targetId);
      },
    },
  });
  const app = new Hono();
  app.use(
    "*",
    createNetworkPolicyMiddleware(host, () => publicOrigin),
  );
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
  // Webhook triggers: a POST to /api/webhooks/:id arms a trailing debounce per
  // automation (coalesces duplicate delivery) with an in-flight overlap guard.
  // Stateless vs the watch/event managers — nothing to arm, so no sync().
  const webhookTriggerManager = new WebhookTriggerManager({
    debounceMs: AUTOMATION_WEBHOOK_DEBOUNCE_MS,
    isRunInFlight: (automationId) => {
      const status = automationStore.get(automationId)?.runs[0]?.status;
      return status === "launched" || status === "running";
    },
    getAutomation: (automationId) => automationStore.get(automationId),
  });
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
  const clientSockets = new Set<ClientSocket>();
  // CDP target paired with each WS via the {type:"identify"} handshake, so the
  // manager's onClientExit hook can drive closeTab on a clean shell exit for
  // that specific socket. Per-WS (a CDP target belongs to one page); cleared
  // on detach.
  const wsToTargetId = new Map<ClientSocket, string>();
  const cdpBackgroundTabsDisabled = process.env.LOCALTERM_DISABLE_CDP_TABS === "1";
  // One persistent CDP socket for the daemon's lifetime — opened once at start
  // (below), so the user clears the browser's remote-debugging prompt a single
  // time rather than on every run. Skipped when a caller injects its own
  // `tabController` (it owns tab control) or when disabled via env.
  const cdpClient =
    options.tabController || cdpBackgroundTabsDisabled
      ? null
      : new CdpClient({
          detect: options.cdpDetect,
          // Only page-type targets on the daemon's own origin get an ambient token
          // injected — unrelated tabs the user has open in their debugged browser
          // stay untouched. `actualPort` is bound by the http server's listen
          // callback below; the filter is only invoked at targetCreated event
          // time (after CdpClient.connect, which runs after listen), so it reads
          // the resolved port rather than the pre-bind placeholder. `publicOrigin`
          // is read live for the same reason — set post-bind via setPublicUrl.
          tabUrlFilter: (candidateUrl: string) =>
            isLocaltermTabUrl(candidateUrl, actualPort, host, publicOrigin),
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
  // Announced surface origin for automation-run tabs (tailnet / portless / null
  // = loopback). A `let` rather than a const so the CLI can swap it in after
  // `listen` resolves the bound port and surface; `tryLaunch` and the CDP
  // `tabUrlFilter` read it live, so a post-bind `setPublicUrl` takes effect
  // for runs and token injection without re-wiring either closure.
  let publicOrigin: string | null = options.publicUrl ?? null;
  const setPublicUrl = (url: string | null): void => {
    publicOrigin = url;
  };

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
    trigger: "schedule" | "manual" | "watch" | "event" | "webhook",
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
    // Open the run tab at the announced surface origin when the CLI resolved
    // one (tailnet / portless), else the loopback form. The CLI sets this post-
    // bind via setPublicUrl; a bare origin (no path) is the contract, so the
    // `new URL` base rewrites any stray path and searchParams encodes the id.
    const runUrl = new URL(publicOrigin ?? `http://${FRIENDLY_HOSTNAME}:${actualPort}`);
    runUrl.searchParams.set(AUTOMATION_RUN_QUERY_PARAM, run.runId);
    void tabController
      .open(runUrl.href)
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
  api.get("/health", (context) =>
    context.json({
      ok: true,
      sessions: registry.size(),
      cdp: cdpClient
        ? { connected: cdpClient.isConnected(), browser: cdpClient.connectedBrowser?.name }
        : null,
    }),
  );

  // The session picker: every live PTY (attached or dormant), so a tab can
  // switch to one by id or kill one it no longer wants. `clients` is the count
  // of attached sockets — 0 marks a dormant shell left behind by a closed tab,
  // which is exactly the row the picker exists to surface.
  api.get("/sessions", (context) => context.json({ sessions: registry.list() }));

  api.delete("/sessions/:id", (context) => {
    const killed = registry.kill(context.req.param("id"));
    if (!killed) return context.json({ error: "not_found" }, HTTP_STATUS_NOT_FOUND);
    return context.json({ ok: true });
  });

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

  // Serves a working-tree image for the diff viewer's inline preview and
  // "open image" button. Gated to image content types so it can never serve an
  // arbitrary HTML/text file from the same origin (which would let a repo
  // file XSS the terminal app). SVG additionally carries a CSP that blocks
  // script execution even when navigated to directly. no-store keeps the
  // preview current after an in-place edit rather than caching a stale copy.
  api.get("/file", async (context) => {
    const cwd = resolveCwdQuery(context.req.query("cwd"));
    if (!cwd) return context.json({ error: "invalid_cwd" }, HTTP_STATUS_BAD_REQUEST);
    const filePath = sanitizeDiffPath(context.req.query("path"));
    if (!filePath) return context.json({ error: "invalid_path" }, HTTP_STATUS_BAD_REQUEST);
    const asset = resolveImageAsset(cwd, filePath);
    if (!asset) return context.text("not found", HTTP_STATUS_NOT_FOUND);
    const headers: Record<string, string> = {
      "content-type": asset.contentType,
      "content-disposition": "inline",
      "cache-control": "no-store",
    };
    if (asset.isSvg) {
      headers["content-security-policy"] = "default-src 'none'; style-src 'unsafe-inline'";
    }
    return new Response(new Uint8Array(asset.body), { status: 200, headers });
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
        env: { ...process.env, PATH: shellPathForUserShell() },
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
    if (normalized.kind === "watch" || normalized.kind === "event" || normalized.kind === "webhook")
      return true;
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

  // Fire a webhook-triggered automation. The :id is the automation's webhook
  // capability token (Discord-style: anyone with the URL can fire it). The body
  // is intentionally ignored — the command/cwd are fixed at create time, so a
  // webhook is a pure signal like schedule/watch/event. The network policy
  // middleware already gates this to the bound surface (loopback, or any
  // private host on a tailnet/non-loopback bind, which covers tailscale's
  // 100.64.0.0/10 CGNAT range), so a POST from another tailnet device reaches
  // it with no extra wiring. Always 2xx on a valid+active id so a CI retry
  // loop never amplifies: duplicates inside the debounce window coalesce, and a
  // POST while a run is in flight is silently dropped (both return 202).
  api.post("/webhooks/:id", (context) => {
    const automation = automationStore.getByWebhookId(context.req.param("id"));
    if (!automation) return context.json({ error: "not_found" }, HTTP_STATUS_NOT_FOUND);
    if (!automation.enabled || automation.lifecycle === "finished") {
      return context.json({ error: "automation_not_active" }, HTTP_STATUS_CONFLICT);
    }
    webhookTriggerManager.trigger(automation);
    return context.json({ accepted: true }, HTTP_STATUS_ACCEPTED);
  });

  api.notFound((context) => context.json({ error: "not_found" }, HTTP_STATUS_NOT_FOUND));
  app.route("/api", api);

  app.get(
    "/ws",
    upgradeWebSocket((context) => {
      let activeWs: ClientSocket | null = null;
      let claimedRunId: string | null = null;
      // Server-side id of the PTY this WS is attached to. Sent to the client in
      // the {type:"session"} frame so a reconnect or switch carries it back as
      // `?sid=` and the manager attaches to the live PTY instead of spawning.
      let sessionId: string | null = null;
      // The managed session this socket is attached to (null after detach). The
      // manager owns the PTY's listeners, fan-out, and lifecycle; this reference
      // is only for the heartbeat's pid label.
      let managed: ManagedSession | null = null;
      let heartbeatTimer: NodeJS.Timeout | null = null;
      let stopHeartbeat: (() => void) | null = null;

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
      // close on a transport failure; without this guard both would detach
      // twice). Detaches this socket from its PTY — the PTY itself stays alive
      // (dormant if this was the last client) so the session picker can
      // re-attach to it. The manager disposes the PTY on shell exit or kill.
      let sessionFinalized = false;
      const releaseSessionFromSocket = () => {
        if (sessionFinalized || !activeWs) return;
        sessionFinalized = true;
        const ws = activeWs;
        registry.detach(ws);
        wsToTargetId.delete(ws);
        clientSockets.delete(ws);
        releaseRunTabHandle();
        managed = null;
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
      const requestedRunId = context.req.query(AUTOMATION_RUN_QUERY_PARAM);
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
          // Reattach if `?sid=` names a PTY the manager still has live (a
          // transient drop, or a switch from the session picker). A miss
          // (shell exited while dormant, killed, or reaped by the idle
          // sweep) falls through to a fresh spawn.
          const attached = requestedSid ? registry.attach(ws, requestedSid) : null;
          if (attached) {
            managed = attached;
            sessionId = attached.id;
          } else {
            if (registry.atCapacity()) {
              ws.close(WS_CLOSE_CAPACITY_REACHED, "session capacity reached");
              return;
            }
            // Claims are single-use: a reload of a ?run= tab gets a plain
            // shell in the same cwd instead of re-running the scheduled command.
            const claimedRun = requestedRunId ? automationRunTracker.claim(requestedRunId) : null;
            let sessionCwd = requestedCwd;
            if (claimedRun) {
              try {
                if (fs.statSync(claimedRun.cwd).isDirectory()) sessionCwd = claimedRun.cwd;
              } catch {
                /* automation cwd vanished since creation; fall back to default */
              }
            }
            const automation: AutomationContext | undefined = claimedRun
              ? { automationId: claimedRun.automationId, runId: claimedRun.runId }
              : undefined;
            const spawned = registry.spawnAndAttach(
              ws,
              { cwd: sessionCwd, initialCommand: claimedRun?.command ?? requestedInitialCommand },
              automation,
            );
            if (!spawned) {
              ws.close(WS_CLOSE_CAPACITY_REACHED, "session capacity reached");
              return;
            }
            managed = spawned;
            sessionId = spawned.id;
            if (claimedRun) {
              claimedRunId = claimedRun.runId;
              automationStore.updateRun(claimedRun.automationId, claimedRun.runId, {
                status: "running",
                startedAt: Date.now(),
              });
              broadcastAutomations();
            }
          }
          if (!managed) return;
          clientSockets.add(ws);
          const liveSession = managed.session;

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
          // half-open one stays silent and terminates on the next tick.
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

          safeSend(ws, {
            type: "session",
            shell: liveSession.shell,
            shellName: liveSession.shellBaseName,
            pid: liveSession.pid,
            cwd: liveSession.lastEmittedCwd || liveSession.cwd,
            title: liveSession.currentTitle || liveSession.initialDocumentTitle,
            id: sessionId ?? undefined,
          });
          // Tell this tab the current keep-awake state so its coffee toggle
          // renders correctly (and is hidden where caffeinate is unsupported).
          safeSend(ws, caffeinateStatePayload());
        },
        onMessage(event) {
          if (!activeWs) return;
          const ws = activeWs;
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
            registry.writeInput(ws, parsed.data.data);
          } else if (parsed.data.type === "resize") {
            registry.resize(
              ws,
              parsed.data.cols,
              parsed.data.rows,
              parsed.data.pixelWidth,
              parsed.data.pixelHeight,
            );
          } else if (parsed.data.type === "ready") {
            // Attach handshake: the client has the {type:"session"} frame and
            // says whether it wants the scrollback replay (a switch to a PTY
            // it didn't already have on screen) before live fan-out begins.
            registry.promote(ws, parsed.data.replay);
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
            // `token:null` means injection hasn't landed yet (page opened its WS
            // before the CdpClient observed it) — wait for the page to
            // re-identify on the 'localterm-token' event rather than pairing
            // eagerly against a null token. We always ack the client either
            // way so its markShellDead path knows whether to fall back to
            // window.close() or wait for the CDP-driven close.
            const token = parsed.data.token;
            if (token !== null) {
              const targetId = cdpClient?.findTargetIdForToken(token);
              if (targetId) wsToTargetId.set(ws, targetId);
            }
            safeSend(ws, {
              type: "cdp-controlled",
              controlled: wsToTargetId.has(ws),
            });
          }
        },
        onClose(event) {
          stopHeartbeatChecks();
          // Most "the terminal randomly died" reports are actually the WS
          // closing for a reason we never surfaced; logging code+reason+
          // wasClean here makes the next incident a 1-line lookup in
          // ~/.localterm/server.log.
          const pidLabel = managed ? ` pid ${managed.session.pid}` : "";
          console.info(
            `ws closed${pidLabel}: code=${event.code} reason=${JSON.stringify(event.reason)} wasClean=${event.wasClean}`,
          );
          releaseRunTabHandle();
          releaseSessionFromSocket();
        },
        onError(event) {
          stopHeartbeatChecks();
          const errorValue =
            event && typeof event === "object" ? (Reflect.get(event, "error") ?? event) : event;
          const message = errorValue instanceof Error ? errorValue.message : String(errorValue);
          const pidLabel = managed ? ` pid ${managed.session.pid}` : "";
          console.error(`ws error${pidLabel}: ${message}`);
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
  webhookTriggerManager.on("due", (automation) => {
    tryLaunch(automation, "webhook");
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
    webhookTriggerManager.dispose();
    caffeinateManager.dispose();
    cdpClient?.close();
    registry.disposeAll();
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

  return { port: actualPort, host, registry, setPublicUrl, stop };
};

export type { Session } from "./session.js";
export type {
  SessionManager,
  ManagedSession,
  AutomationContext,
  SessionListItem,
} from "./session-manager.js";
export { CaffeinateController } from "./caffeinate-controller.js";
export type {
  CaffeinateControllerOptions,
  CaffeinateProcessHandle,
} from "./caffeinate-controller.js";
export type * from "./types.js";
export { DEFAULT_HOST, DEFAULT_PORT, WS_CLOSE_BACKPRESSURE } from "./constants.js";
export { isLoopbackHost, isPrivateHost, isAllowedSourceIp } from "./security.js";
export { healthSchema, cdpHealthSchema } from "./schemas.js";
export { detectChromiumBrowsers } from "./cdp/detect-chromium.js";
export type { BrowserCandidate, DetectedBrowser } from "./cdp/detect-chromium.js";
export {
  ServerErrorException,
  formatServerError,
  isServerErrorException,
  serverError,
} from "./errors.js";
export type { ServerError, ServerErrorCode, ServerErrorKind } from "./errors.js";
