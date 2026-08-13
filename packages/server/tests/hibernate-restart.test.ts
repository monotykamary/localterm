import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { WebSocket } from "ws";
import { HIBERNATE_FILENAME } from "../src/constants.js";
import { createServer, type RunningServer } from "../src/index.js";
import { pollFor } from "./helpers/poll-for.js";

interface SessionFrame {
  id?: string;
}

const connectTab = (
  server: RunningServer,
  params: Record<string, string>,
): Promise<{ socket: WebSocket; session: SessionFrame; output: () => string }> =>
  new Promise((resolve, reject) => {
    const query = new URLSearchParams(params).toString();
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws?${query}`);
    socket.binaryType = "arraybuffer";
    let output = "";
    const timer = setTimeout(() => reject(new Error("session frame timeout")), 10_000);
    socket.addEventListener("message", (event) => {
      if (event.data instanceof ArrayBuffer) {
        output += Buffer.from(event.data).toString("utf8");
        return;
      }
      try {
        const message = JSON.parse(event.data as string) as { type?: string };
        if (message.type !== "session") return;
        clearTimeout(timer);
        resolve({ socket, session: message, output: () => output });
      } catch {
        /* ignore non-JSON control frames */
      }
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("websocket error"));
    });
  });

describe("rendered scrollback hibernation", { tags: ["integration"] }, () => {
  const servers: RunningServer[] = [];
  const sockets: WebSocket[] = [];
  const dirs: string[] = [];

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.terminate();
    for (const server of servers.splice(0)) await server.stop().catch(() => {});
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  const startServer = async (stateDirectory: string): Promise<RunningServer> => {
    const server = await createServer({
      port: 0,
      host: "127.0.0.1",
      stateDirectory,
      tabController: { open: async () => null, close: async () => {} },
    });
    servers.push(server);
    return server;
  };

  it("restores plain normal-buffer text across two daemon restarts", async () => {
    const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "localterm-hibernate-state-"));
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "localterm-hibernate-cwd-"));
    dirs.push(stateDirectory, cwd);
    const params = { cwd, shell: "/bin/sh", wid: "desktop-window" };
    const firstMarker = "SIMPLE_HIBERNATE_FIRST";
    const secondMarker = "SIMPLE_HIBERNATE_SECOND";

    const firstServer = await startServer(stateDirectory);
    const firstTab = await connectTab(firstServer, params);
    sockets.push(firstTab.socket);
    firstTab.socket.send(JSON.stringify({ type: "ready", replay: true }));
    firstTab.socket.send(JSON.stringify({ type: "input", data: `echo ${firstMarker}\n` }));
    expect(await pollFor(() => firstTab.output().includes(firstMarker), 10_000)).toBe(true);

    // Stop while the terminal is in an alternate-screen frame. The browser saw
    // this frame, but hibernation must persist only the rendered normal buffer.
    firstTab.socket.send(
      JSON.stringify({
        type: "input",
        data: "printf '\\033[?1049hDEAD_'; printf 'TUI_FRAME'\n",
      }),
    );
    expect(await pollFor(() => firstTab.output().includes("DEAD_TUI_FRAME"), 10_000)).toBe(true);
    await firstServer.stop();
    servers.splice(servers.indexOf(firstServer), 1);

    const firstFile = fs.readFileSync(path.join(stateDirectory, HIBERNATE_FILENAME), "utf8");
    const firstSnapshot = JSON.parse(firstFile) as {
      entries: { tabs: { sessionId: string; scrollback: string }[] }[];
    };
    const firstStoredTab = firstSnapshot.entries[0]?.tabs[0];
    expect(firstStoredTab?.sessionId).toBe(firstTab.session.id);
    expect(firstStoredTab?.scrollback).toContain(firstMarker);
    expect(firstStoredTab?.scrollback).not.toContain("DEAD_TUI_FRAME");
    expect(firstStoredTab?.scrollback).not.toContain("\x1b");
    await firstServer.stop();
    expect(fs.readFileSync(path.join(stateDirectory, HIBERNATE_FILENAME), "utf8")).toBe(firstFile);

    const secondServer = await startServer(stateDirectory);
    const secondTab = await connectTab(secondServer, {
      ...params,
      sid: firstTab.session.id as string,
    });
    sockets.push(secondTab.socket);
    secondTab.socket.send(JSON.stringify({ type: "ready", replay: true }));
    expect(await pollFor(() => secondTab.output().includes(firstMarker), 10_000)).toBe(true);
    expect(secondTab.output()).not.toContain("DEAD_TUI_FRAME");
    expect(secondTab.session.id).not.toBe(firstTab.session.id);

    secondTab.socket.send(JSON.stringify({ type: "input", data: `echo ${secondMarker}\n` }));
    expect(await pollFor(() => secondTab.output().includes(secondMarker), 10_000)).toBe(true);
    await secondServer.stop();
    servers.splice(servers.indexOf(secondServer), 1);

    const secondSnapshot = JSON.parse(
      fs.readFileSync(path.join(stateDirectory, HIBERNATE_FILENAME), "utf8"),
    ) as { entries: { tabs: { sessionId: string; scrollback: string }[] }[] };
    const secondStoredTab = secondSnapshot.entries[0]?.tabs[0];
    expect(secondStoredTab?.sessionId).toBe(secondTab.session.id);
    expect(secondStoredTab?.scrollback).toContain(firstMarker);
    expect(secondStoredTab?.scrollback).toContain(secondMarker);

    const thirdServer = await startServer(stateDirectory);
    const thirdTab = await connectTab(thirdServer, {
      ...params,
      sid: secondTab.session.id as string,
    });
    sockets.push(thirdTab.socket);
    thirdTab.socket.send(JSON.stringify({ type: "ready", replay: true }));
    expect(
      await pollFor(
        () => thirdTab.output().includes(firstMarker) && thirdTab.output().includes(secondMarker),
        10_000,
      ),
    ).toBe(true);
  }, 60_000);
});
