import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve, type ServerType } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  DEFAULT_HOST,
  DEFAULT_PORT,
  HTTP_STATUS_BAD_REQUEST,
  HTTP_STATUS_CREATED,
  HTTP_STATUS_NOT_FOUND,
  HTTP_STATUS_NO_CONTENT,
  HTTP_STATUS_PAYLOAD_TOO_LARGE,
  MAX_BODY_BYTES,
  WS_BACKPRESSURE_THRESHOLD_BYTES,
  WS_CLOSE_BACKPRESSURE,
  WS_CLOSE_POLICY_VIOLATION,
  WS_CLOSE_SESSION_NOT_FOUND,
  WS_READY_STATE_OPEN,
} from "./constants.js";
import { clientToServerMessageSchema, createSessionInputSchema } from "./schemas.js";
import { enforceLoopback, isLoopbackHost, loopbackMiddleware } from "./security.js";
import { SessionManager } from "./session-manager.js";
import { resolveStaticAsset } from "./static-resolver.js";
import type { ServerToClientMessage } from "./types.js";

export interface ServerOptions {
  port?: number;
  host?: string;
  staticRoot?: string | null;
}

export interface RunningServer {
  port: number;
  host: string;
  manager: SessionManager;
  stop: () => Promise<void>;
}

interface BroadcastSocket {
  readyState: number;
  send: (raw: string) => void;
  close: (code?: number, reason?: string) => void;
  raw?: unknown;
}

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const defaultStaticRoot = path.resolve(moduleDir, "../../web/dist");

const getRawBufferedAmount = (raw: unknown): number => {
  if (!raw || typeof raw !== "object") return 0;
  const candidate = Reflect.get(raw, "bufferedAmount");
  return typeof candidate === "number" ? candidate : 0;
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
  if (!isLoopbackHost(host)) {
    throw new Error(`refusing to bind non-loopback host '${host}': pass 127.0.0.1 or localhost`);
  }

  const staticRoot =
    options.staticRoot === null ? null : path.resolve(options.staticRoot ?? defaultStaticRoot);

  const manager = new SessionManager();
  const app = new Hono();
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

  const api = new Hono();
  api.use("*", loopbackMiddleware);

  api.get("/health", (context) => context.json({ ok: true, sessions: manager.size() }));

  api.get("/sessions", (context) => context.json(manager.list()));

  api.post(
    "/sessions",
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (context) =>
        context.json({ error: "body_too_large" }, HTTP_STATUS_PAYLOAD_TOO_LARGE),
    }),
    async (context) => {
      let raw: unknown = {};
      try {
        raw = await context.req.json();
      } catch {
        raw = {};
      }
      const parsed = createSessionInputSchema.safeParse(raw);
      if (!parsed.success) {
        return context.json(
          { error: "invalid_body", issues: parsed.error.issues },
          HTTP_STATUS_BAD_REQUEST,
        );
      }
      const session = await manager.create(parsed.data);
      return context.json(session.metadata(), HTTP_STATUS_CREATED);
    },
  );

  api.delete("/sessions/:id", (context) => {
    const sessionId = context.req.param("id");
    const removed = manager.remove(sessionId);
    if (!removed) return context.json({ error: "not_found" }, HTTP_STATUS_NOT_FOUND);
    return context.body(null, HTTP_STATUS_NO_CONTENT);
  });

  api.notFound((context) => context.json({ error: "not_found" }, HTTP_STATUS_NOT_FOUND));

  app.route("/api", api);

  app.get(
    "/ws/:id",
    upgradeWebSocket((context) => {
      const blocked = enforceLoopback(context);
      if (blocked) {
        return { onOpen: (_event, ws) => ws.close(WS_CLOSE_POLICY_VIOLATION, "forbidden") };
      }

      const sessionId = context.req.param("id") ?? "";
      let detach: (() => void) | null = null;
      return {
        onOpen(_event, ws) {
          const session = sessionId ? manager.get(sessionId) : undefined;
          if (!session) {
            ws.close(WS_CLOSE_SESSION_NOT_FOUND, "session_not_found");
            return;
          }
          manager.attach(sessionId);
          safeSend(ws, session.snapshot());

          const onOutput = (data: string) => safeSend(ws, { type: "output", data });
          const onTitle = (title: string) => safeSend(ws, { type: "title", title });
          const onExit = (code: number | null) => safeSend(ws, { type: "exit", code });
          session.on("output", onOutput);
          session.on("title", onTitle);
          session.on("exit", onExit);
          detach = () => {
            session.off("output", onOutput);
            session.off("title", onTitle);
            session.off("exit", onExit);
            manager.detach(sessionId);
          };
        },
        onMessage(event) {
          const session = sessionId ? manager.get(sessionId) : undefined;
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
            session.resize(parsed.data.cols, parsed.data.rows);
          }
        },
        onClose() {
          detach?.();
          detach = null;
        },
        onError() {
          detach?.();
          detach = null;
        },
      };
    }),
  );

  if (staticRoot) {
    app.get("*", (context) => {
      const requestPath = context.req.path;
      if (requestPath.startsWith("/api/") || requestPath.startsWith("/ws/")) {
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
  await new Promise<void>((resolve, reject) => {
    const handleError = (error: Error) => {
      reject(error);
    };
    const node = serve(
      {
        fetch: app.fetch,
        hostname: host,
        port,
      },
      () => {
        node.removeListener("error", handleError);
        resolve();
      },
    );
    node.once("error", handleError);
    httpServer = node;
  });
  if (!httpServer) throw new Error("server_failed_to_start");
  injectWebSocket(httpServer);

  const stop = async () => {
    manager.disposeAll();
    if (!httpServer) return;
    const target = httpServer;
    const closeAllConnections = Reflect.get(target, "closeAllConnections");
    if (typeof closeAllConnections === "function") {
      closeAllConnections.call(target);
    }
    await new Promise<void>((resolve) => {
      target.close(() => resolve());
    });
  };

  return { port, host, manager, stop };
};

export type { SessionManager } from "./session-manager.js";
export type { Session } from "./session.js";
export type * from "./types.js";
export {
  DEFAULT_HOST,
  DEFAULT_PORT,
  WS_CLOSE_BACKPRESSURE,
  WS_CLOSE_SESSION_NOT_FOUND,
} from "./constants.js";
export { isLoopbackHost } from "./security.js";
export { healthSchema, sessionMetadataSchema, sessionsListSchema } from "./schemas.js";
