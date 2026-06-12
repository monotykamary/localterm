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
import {
  DEFAULT_HOST,
  DEFAULT_PORT,
  FRIENDLY_HOSTNAME,
  HTTP_STATUS_BAD_REQUEST,
  HTTP_STATUS_CREATED,
  HTTP_STATUS_NOT_FOUND,
  MAX_AUTOMATIONS,
  MAX_CONCURRENT_SESSIONS,
  OUTPUT_BATCH_FLUSH_BYTES,
  OUTPUT_BATCH_WINDOW_MS,
  SERVER_STOP_GRACE_MS,
  WS_BACKPRESSURE_THRESHOLD_BYTES,
  WS_CLOSE_BACKPRESSURE,
  WS_CLOSE_CAPACITY_REACHED,
  WS_CLOSE_POLICY_VIOLATION,
  WS_HEARTBEAT_INTERVAL_MS,
  WS_HEARTBEAT_TIMEOUT_MS,
  WS_OUTBOUND_DRAIN_POLL_MS,
  WS_OUTBOUND_PAUSE_HIGH_WATER_BYTES,
  WS_OUTBOUND_RESUME_LOW_WATER_BYTES,
  WS_READY_STATE_OPEN,
} from "./constants.js";
import { ServerErrorException, serverError } from "./errors.js";
import { getGitDiff, getGitDiffSummary } from "./git-diff.js";
import { GitDiffWatcher } from "./git-diff-watcher.js";
import { parseCronExpression } from "./cron-expression.js";
import {
  clientToServerMessageSchema,
  createAutomationInputSchema,
  updateAutomationInputSchema,
} from "./schemas.js";
import { Session } from "./session.js";
import { createNetworkPolicyMiddleware, isAllowedSourceIp, isLoopbackHost } from "./security.js";
import { SessionRegistry } from "./session-registry.js";
import { resolveStaticAsset } from "./static-resolver.js";
import { computeNextAutomationRunAt } from "./utils/compute-next-automation-run-at.js";
import type { Automation, AutomationWithNextRun, ServerToClientMessage } from "./types.js";

export interface ServerOptions {
  port?: number;
  host?: string;
  staticRoot?: string | null;
  stateDirectory?: string;
  openUrl?: (url: string) => Promise<void>;
}

export interface RunningServer {
  port: number;
  host: string;
  registry: SessionRegistry;
  stop: () => Promise<void>;
}

interface BroadcastSocket {
  readyState: number;
  send: (raw: string) => void;
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
  const app = new Hono();
  app.use("*", createNetworkPolicyMiddleware(host));
  const { injectWebSocket, upgradeWebSocket, wss } = createNodeWebSocket({ app });
  wss.options.maxPayload = 256 * 1024;

  const stateDirectory = options.stateDirectory ?? path.join(os.homedir(), ".localterm");
  const automationStore = new AutomationStore(path.join(stateDirectory, "automations.json"));
  const automationRunTracker = new AutomationRunTracker();
  const automationScheduler = new AutomationScheduler(automationStore);
  const clientSockets = new Set<BroadcastSocket>();
  const openUrl =
    options.openUrl ??
    (async (url: string) => {
      await open(url);
    });

  const toAutomationWithNextRun = (automation: Automation, from: Date): AutomationWithNextRun => ({
    ...automation,
    nextRunAt: computeNextAutomationRunAt(automation, from),
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

  const launchAutomationRun = (automation: Automation) => {
    const run = automationRunTracker.create(automation);
    automationStore.recordLastRun(automation.id, {
      runId: run.runId,
      at: run.createdAt,
      status: "launched",
      exitCode: null,
    });
    broadcastAutomations();
    const runUrl = `http://${FRIENDLY_HOSTNAME}:${actualPort}/?run=${run.runId}`;
    void openUrl(runUrl).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`failed to open a browser tab for automation "${automation.name}": ${message}`);
    });
    return run;
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

  api.get("/git/diff", async (context) => {
    const cwd = resolveCwdQuery(context.req.query("cwd"));
    if (!cwd) return context.json({ error: "invalid_cwd" }, HTTP_STATUS_BAD_REQUEST);
    return context.json(await getGitDiff(cwd));
  });

  const readJsonBody = async (context: { req: { json: () => Promise<unknown> } }) => {
    try {
      return await context.req.json();
    } catch {
      return undefined;
    }
  };

  api.get("/automations", (context) => context.json({ automations: listAutomationsWithNextRun() }));

  api.post("/automations", async (context) => {
    const parsed = createAutomationInputSchema.safeParse(await readJsonBody(context));
    if (!parsed.success) return context.json({ error: "invalid_body" }, HTTP_STATUS_BAD_REQUEST);
    if (automationStore.size() >= MAX_AUTOMATIONS) {
      return context.json({ error: "too_many_automations" }, HTTP_STATUS_BAD_REQUEST);
    }
    if (!parseCronExpression(parsed.data.schedule)) {
      return context.json({ error: "invalid_schedule" }, HTTP_STATUS_BAD_REQUEST);
    }
    if (!resolveCwdQuery(parsed.data.cwd)) {
      return context.json({ error: "invalid_cwd" }, HTTP_STATUS_BAD_REQUEST);
    }
    const automation = automationStore.create(parsed.data);
    broadcastAutomations();
    return context.json(
      { automation: toAutomationWithNextRun(automation, new Date()) },
      HTTP_STATUS_CREATED,
    );
  });

  api.patch("/automations/:id", async (context) => {
    const parsed = updateAutomationInputSchema.safeParse(await readJsonBody(context));
    if (!parsed.success) return context.json({ error: "invalid_body" }, HTTP_STATUS_BAD_REQUEST);
    if (parsed.data.schedule !== undefined && !parseCronExpression(parsed.data.schedule)) {
      return context.json({ error: "invalid_schedule" }, HTTP_STATUS_BAD_REQUEST);
    }
    if (parsed.data.cwd !== undefined && !resolveCwdQuery(parsed.data.cwd)) {
      return context.json({ error: "invalid_cwd" }, HTTP_STATUS_BAD_REQUEST);
    }
    const automation = automationStore.update(context.req.param("id"), parsed.data);
    if (!automation) return context.json({ error: "not_found" }, HTTP_STATUS_NOT_FOUND);
    broadcastAutomations();
    return context.json({ automation: toAutomationWithNextRun(automation, new Date()) });
  });

  api.delete("/automations/:id", (context) => {
    if (!automationStore.remove(context.req.param("id"))) {
      return context.json({ error: "not_found" }, HTTP_STATUS_NOT_FOUND);
    }
    broadcastAutomations();
    return context.json({ ok: true });
  });

  api.post("/automations/:id/run", (context) => {
    const automation = automationStore.get(context.req.param("id"));
    if (!automation) return context.json({ error: "not_found" }, HTTP_STATUS_NOT_FOUND);
    const run = launchAutomationRun(automation);
    return context.json({ runId: run.runId });
  });

  api.notFound((context) => context.json({ error: "not_found" }, HTTP_STATUS_NOT_FOUND));
  app.route("/api", api);

  app.get(
    "/ws",
    upgradeWebSocket((context) => {
      let session: Session | null = null;
      let activeWs: BroadcastSocket | null = null;
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
          let sessionCwd = requestedCwd;
          if (claimedRun) {
            try {
              if (fs.statSync(claimedRun.cwd).isDirectory()) sessionCwd = claimedRun.cwd;
            } catch {
              /* automation cwd vanished since creation; fall back to default */
            }
          }
          const newSession = new Session({
            cwd: sessionCwd,
            initialCommand: claimedRun?.command,
          });
          session = newSession;
          registry.register(newSession);

          if (claimedRun) {
            automationStore.recordLastRun(claimedRun.automationId, {
              runId: claimedRun.runId,
              at: Date.now(),
              status: "running",
              exitCode: null,
            });
            broadcastAutomations();
            newSession.on("automation-exit", (exitCode: number) => {
              automationStore.recordLastRun(claimedRun.automationId, {
                runId: claimedRun.runId,
                at: Date.now(),
                status: exitCode === 0 ? "completed" : "failed",
                exitCode,
              });
              broadcastAutomations();
            });
          }

          // Heartbeat. Without this, half-open sockets (laptop sleep, network
          // dropout) never surface as a `close` event and the daemon keeps
          // streaming PTY output into the void. We only enable it if the raw
          // socket exposes `on("pong")` — otherwise the timer would tick with
          // no pongs ever observed and kill healthy connections after the
          // first idle window.
          let lastPongAt = Date.now();
          stopHeartbeat = onRawEvent(ws.raw, "pong", () => {
            lastPongAt = Date.now();
          });
          if (stopHeartbeat) {
            heartbeatTimer = setInterval(() => {
              if (ws.readyState !== WS_READY_STATE_OPEN) return;
              const idleMs = Date.now() - lastPongAt;
              if (idleMs > WS_HEARTBEAT_TIMEOUT_MS) {
                console.warn(
                  `ws heartbeat timeout: no pong for ${idleMs}ms (pid ${newSession.pid}); terminating`,
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
              if (!newSession.isPaused) {
                stopDrainPoll();
                return;
              }
              if (getRawBufferedAmount(ws.raw) <= WS_OUTBOUND_RESUME_LOW_WATER_BYTES) {
                newSession.resume();
                stopDrainPoll();
              }
            }, WS_OUTBOUND_DRAIN_POLL_MS);
            drainPollTimer.unref?.();
          };

          const flushOutputBatch = () => {
            outputBatchTimer = null;
            if (!outputBatch) return;
            const payload = outputBatch;
            outputBatch = "";
            safeSend(ws, { type: "output", data: payload });
            if (
              !newSession.isPaused &&
              getRawBufferedAmount(ws.raw) >= WS_OUTBOUND_PAUSE_HIGH_WATER_BYTES
            ) {
              newSession.pause();
              ensureDrainPoll();
            }
          };

          // Wire listeners so any emit from Session (current or future)
          // reaches the client. Today node-pty's data/exit are async, but
          // this guards against drift.
          const onOutput = (data: string) => {
            outputBatch += data;
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
          const onForeground = (process: string | null) =>
            safeSend(ws, { type: "foreground", process });
          const onNotification = (body: string) => safeSend(ws, { type: "notification", body });
          const onExit = (code: number | null) => {
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
          const handleGitDirty = async () => {
            const cwd = newSession.lastEmittedCwd;
            if (!cwd) return;
            try {
              const summary = await getGitDiffSummary(cwd);
              safeSend(ws, { type: "git-diff-summary", summary });
            } catch {
              /* transient git failure; next dirty signal will retry */
            }
          };

          gitDiffWatcher.on("git-dirty", () => {
            void handleGitDirty();
          });
          gitDiffWatcher.start(newSession.cwd);

          newSession.on("git-dirty", () => {
            void handleGitDirty();
          });
          newSession.on("cwd", (changedCwd: string) => {
            gitDiffWatcher.stop();
            gitDiffWatcher.start(changedCwd);
          });

          newSession.on("output", onOutput);
          newSession.on("title", onTitle);
          newSession.on("cwd", onCwd);
          newSession.on("foreground", onForeground);
          newSession.on("notification", onNotification);
          newSession.on("exit", onExit);

          safeSend(ws, {
            type: "session",
            shell: newSession.shell,
            shellName: newSession.shellBaseName,
            pid: newSession.pid,
            cwd: newSession.cwd,
            title: newSession.initialDocumentTitle,
          });
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
            safeSend(activeWs, { type: "output", data: outputBatch });
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
          if (!session) return;
          registry.unregister(session);
          session.dispose();
          session = null;
          activeWs = null;
        },
        onError(event) {
          if (outputBatchTimer !== null) {
            clearTimeout(outputBatchTimer);
            outputBatchTimer = null;
          }
          if (outputBatch && activeWs) {
            safeSend(activeWs, { type: "output", data: outputBatch });
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
          if (!session) return;
          registry.unregister(session);
          session.dispose();
          session = null;
          activeWs = null;
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
    launchAutomationRun(automation);
  });
  automationScheduler.on("tick", (now) => {
    let didExpireAny = false;
    for (const expiredRun of automationRunTracker.sweepExpired(now.getTime())) {
      const automation = automationStore.get(expiredRun.automationId);
      if (automation?.lastRun?.runId !== expiredRun.runId) continue;
      if (automation.lastRun.status !== "launched") continue;
      automationStore.recordLastRun(automation.id, { ...automation.lastRun, status: "missed" });
      didExpireAny = true;
    }
    if (didExpireAny) broadcastAutomations();
  });
  automationScheduler.start();

  const stop = async () => {
    automationScheduler.dispose();
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

  return { port: actualPort, host, registry, stop };
};

export type { Session } from "./session.js";
export type { SessionRegistry } from "./session-registry.js";
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
