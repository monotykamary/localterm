import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve, type ServerType } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { Hono } from "hono";
import {
  DEFAULT_HOST,
  DEFAULT_PORT,
  HTTP_STATUS_NOT_FOUND,
  WS_BACKPRESSURE_THRESHOLD_BYTES,
  WS_CLOSE_BACKPRESSURE,
  WS_CLOSE_POLICY_VIOLATION,
  WS_READY_STATE_OPEN,
} from "./constants.js";
import { clientToServerMessageSchema } from "./schemas.js";
import { enforceLoopback, isLoopbackHost, loopbackMiddleware } from "./security.js";
import { Session } from "./session.js";
import { SessionRegistry } from "./session-registry.js";
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
  registry: SessionRegistry;
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

  const registry = new SessionRegistry();
  const app = new Hono();
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

  const api = new Hono();
  api.use("*", loopbackMiddleware);
  api.get("/health", (context) => context.json({ ok: true, sessions: registry.size() }));
  api.notFound((context) => context.json({ error: "not_found" }, HTTP_STATUS_NOT_FOUND));
  app.route("/api", api);

  app.get(
    "/ws",
    upgradeWebSocket((context) => {
      const blocked = enforceLoopback(context);
      if (blocked) {
        return { onOpen: (_event, ws) => ws.close(WS_CLOSE_POLICY_VIOLATION, "forbidden") };
      }

      let session: Session | null = null;

      return {
        onOpen(_event, ws) {
          session = new Session({});
          registry.register(session);

          const onOutput = (data: string) => safeSend(ws, { type: "output", data });
          const onExit = (code: number | null) => {
            safeSend(ws, { type: "exit", code });
            ws.close();
          };
          session.on("output", onOutput);
          session.on("exit", onExit);
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
            session.resize(parsed.data.cols, parsed.data.rows);
          }
        },
        onClose() {
          if (!session) return;
          registry.unregister(session);
          session.dispose();
          session = null;
        },
        onError() {
          if (!session) return;
          registry.unregister(session);
          session.dispose();
          session = null;
        },
      };
    }),
  );

  if (staticRoot) {
    app.use("*", loopbackMiddleware);
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
    registry.disposeAll();
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

  return { port, host, registry, stop };
};

export type { Session } from "./session.js";
export type { SessionRegistry } from "./session-registry.js";
export type * from "./types.js";
export { DEFAULT_HOST, DEFAULT_PORT, WS_CLOSE_BACKPRESSURE } from "./constants.js";
export { isLoopbackHost } from "./security.js";
export { healthSchema } from "./schemas.js";
