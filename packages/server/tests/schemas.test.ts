import { describe, expect, it } from "vite-plus/test";
import { MAX_FOREGROUND_LENGTH, MAX_INPUT_BYTES, MAX_TITLE_LENGTH } from "../src/constants.js";
import {
  clientToServerMessageSchema,
  serverToClientMessageSchema,
  updateFontsInputSchema,
  migrateFontsInputSchema,
} from "../src/schemas.js";

describe("clientToServerMessageSchema", () => {
  it("accepts an input frame", () => {
    const result = clientToServerMessageSchema.safeParse({ type: "input", data: "ls\r" });
    expect(result.success).toBe(true);
  });

  it("accepts a resize frame", () => {
    const result = clientToServerMessageSchema.safeParse({
      type: "resize",
      cols: 80,
      rows: 24,
    });
    expect(result.success).toBe(true);
  });

  it("rejects oversized input", () => {
    const oversized = "a".repeat(MAX_INPUT_BYTES + 1);
    const result = clientToServerMessageSchema.safeParse({ type: "input", data: oversized });
    expect(result.success).toBe(false);
  });

  it("accepts caffeinate-mode frames for every mode", () => {
    for (const mode of ["off", "on", "automatic"]) {
      expect(clientToServerMessageSchema.safeParse({ type: "caffeinate-mode", mode }).success).toBe(
        true,
      );
    }
  });

  it("rejects a caffeinate-mode frame with an unknown mode", () => {
    expect(
      clientToServerMessageSchema.safeParse({ type: "caffeinate-mode", mode: "sometimes" }).success,
    ).toBe(false);
    expect(clientToServerMessageSchema.safeParse({ type: "caffeinate-mode" }).success).toBe(false);
  });

  it("accepts a caffeinate-commands frame and trims entries", () => {
    const result = clientToServerMessageSchema.safeParse({
      type: "caffeinate-commands",
      commands: ["  ollama  ", "lazygit"],
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.type === "caffeinate-commands") {
      expect(result.data.commands).toEqual(["ollama", "lazygit"]);
    }
  });

  it("rejects a caffeinate-commands frame with a blank command", () => {
    expect(
      clientToServerMessageSchema.safeParse({ type: "caffeinate-commands", commands: ["   "] })
        .success,
    ).toBe(false);
  });

  it("accepts a caffeinate-peer-keep-awake frame with an enabled flag", () => {
    expect(
      clientToServerMessageSchema.safeParse({ type: "caffeinate-peer-keep-awake", enabled: true })
        .success,
    ).toBe(true);
    expect(
      clientToServerMessageSchema.safeParse({ type: "caffeinate-peer-keep-awake", enabled: false })
        .success,
    ).toBe(true);
  });

  it("rejects a caffeinate-peer-keep-awake frame missing the enabled flag", () => {
    expect(
      clientToServerMessageSchema.safeParse({ type: "caffeinate-peer-keep-awake" }).success,
    ).toBe(false);
  });

  it("accepts a caffeinate-battery-threshold frame with a percent or null", () => {
    expect(
      clientToServerMessageSchema.safeParse({
        type: "caffeinate-battery-threshold",
        percent: 20,
      }).success,
    ).toBe(true);
    expect(
      clientToServerMessageSchema.safeParse({
        type: "caffeinate-battery-threshold",
        percent: null,
      }).success,
    ).toBe(true);
  });

  it("rejects a caffeinate-battery-threshold frame out of bounds", () => {
    expect(
      clientToServerMessageSchema.safeParse({
        type: "caffeinate-battery-threshold",
        percent: 4,
      }).success,
    ).toBe(false);
    expect(
      clientToServerMessageSchema.safeParse({
        type: "caffeinate-battery-threshold",
        percent: 51,
      }).success,
    ).toBe(false);
  });

  it("rejects negative dimensions", () => {
    expect(
      clientToServerMessageSchema.safeParse({ type: "resize", cols: 0, rows: 24 }).success,
    ).toBe(false);
    expect(
      clientToServerMessageSchema.safeParse({ type: "resize", cols: 80, rows: -1 }).success,
    ).toBe(false);
  });

  it("rejects unreasonably large dimensions", () => {
    expect(
      clientToServerMessageSchema.safeParse({ type: "resize", cols: 100000, rows: 24 }).success,
    ).toBe(false);
  });

  it("rejects unknown message types", () => {
    expect(
      clientToServerMessageSchema.safeParse({ type: "input", data: "x", extra: "y" }).success,
    ).toBe(false);
    expect(clientToServerMessageSchema.safeParse({ type: "kill" }).success).toBe(false);
  });

  it("rejects missing fields", () => {
    expect(clientToServerMessageSchema.safeParse({ type: "input" }).success).toBe(false);
    expect(clientToServerMessageSchema.safeParse({ type: "resize", cols: 80 }).success).toBe(false);
  });

  it("parses the ready handshake with a replay flag", () => {
    expect(clientToServerMessageSchema.safeParse({ type: "ready", replay: true }).success).toBe(
      true,
    );
    expect(clientToServerMessageSchema.safeParse({ type: "ready", replay: false }).success).toBe(
      true,
    );
    expect(clientToServerMessageSchema.safeParse({ type: "ready" }).success).toBe(false);
  });
});

describe("serverToClientMessageSchema", () => {
  it("accepts every JSON variant", () => {
    expect(serverToClientMessageSchema.safeParse({ type: "exit", code: 0 }).success).toBe(true);
    expect(serverToClientMessageSchema.safeParse({ type: "exit", code: null }).success).toBe(true);
    expect(serverToClientMessageSchema.safeParse({ type: "title", title: "shell" }).success).toBe(
      true,
    );
    expect(serverToClientMessageSchema.safeParse({ type: "replay-end" }).success).toBe(true);
    expect(serverToClientMessageSchema.safeParse({ type: "peer-attached" }).success).toBe(true);
    expect(
      serverToClientMessageSchema.safeParse({ type: "pty-size", cols: 80, rows: 24 }).success,
    ).toBe(true);
  });

  // Output is NOT a JSON member of the union — the server emits it as a binary
  // WebSocket frame (sendOutputBatchBytes in src/index.ts), and the client
  // dispatches by `event.data instanceof ArrayBuffer` in terminal.tsx. Asserting
  // rejection here guards against accidentally re-adding the JSON path.
  it("rejects JSON output frames (output is binary-only)", () => {
    expect(serverToClientMessageSchema.safeParse({ type: "output", data: "x" }).success).toBe(
      false,
    );
  });

  it("accepts a notification carrying hasViewers", () => {
    expect(
      serverToClientMessageSchema.safeParse({
        type: "notification",
        sessionId: "00000000-0000-0000-0000-000000000000",
        body: "build done",
        hasViewers: true,
      }).success,
    ).toBe(true);
  });

  it("rejects a notification missing hasViewers", () => {
    expect(
      serverToClientMessageSchema.safeParse({
        type: "notification",
        sessionId: "00000000-0000-0000-0000-000000000000",
        body: "build done",
      }).success,
    ).toBe(false);
  });

  it("rejects the legacy snapshot frame", () => {
    expect(
      serverToClientMessageSchema.safeParse({
        type: "snapshot",
        data: "x",
        cols: 80,
        rows: 24,
        title: "shell",
      }).success,
    ).toBe(false);
  });

  it("rejects title frames missing the title field", () => {
    expect(serverToClientMessageSchema.safeParse({ type: "title" }).success).toBe(false);
  });

  it("rejects oversized title payloads", () => {
    const oversized = "a".repeat(MAX_TITLE_LENGTH + 1);
    expect(serverToClientMessageSchema.safeParse({ type: "title", title: oversized }).success).toBe(
      false,
    );
  });

  it("accepts a session info frame", () => {
    const result = serverToClientMessageSchema.safeParse({
      type: "session",
      shell: "/bin/zsh",
      shellName: "zsh",
      pid: 12345,
      cwd: "/Users/tester",
      title: "~",
      foreground: "vim",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a session frame with null foreground (idle shell)", () => {
    const result = serverToClientMessageSchema.safeParse({
      type: "session",
      shell: "/bin/zsh",
      shellName: "zsh",
      pid: 12345,
      cwd: "/Users/tester",
      title: "~",
      foreground: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects session frames with oversized foreground", () => {
    const oversized = "a".repeat(MAX_FOREGROUND_LENGTH + 1);
    const result = serverToClientMessageSchema.safeParse({
      type: "session",
      shell: "/bin/zsh",
      shellName: "zsh",
      pid: 1,
      cwd: "/Users/tester",
      title: "~",
      foreground: oversized,
    });
    expect(result.success).toBe(false);
  });

  it("rejects session frames missing required fields", () => {
    const result = serverToClientMessageSchema.safeParse({
      type: "session",
      shell: "/bin/zsh",
      pid: 12345,
      cwd: "/Users/tester",
    });
    expect(result.success).toBe(false);
  });

  it("rejects session frames with negative PID", () => {
    const result = serverToClientMessageSchema.safeParse({
      type: "session",
      shell: "/bin/zsh",
      shellName: "zsh",
      pid: -1,
      cwd: "/Users/tester",
      title: "~",
      foreground: null,
    });
    expect(result.success).toBe(false);
  });

  it("rejects session frames with empty string fields", () => {
    const result = serverToClientMessageSchema.safeParse({
      type: "session",
      shell: "",
      shellName: "zsh",
      pid: 1,
      cwd: "/Users/tester",
      title: "~",
      foreground: null,
    });
    expect(result.success).toBe(false);
  });

  it("accepts a foreground frame with a process name", () => {
    const result = serverToClientMessageSchema.safeParse({
      type: "foreground",
      process: "vim",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a foreground frame with null (idle shell)", () => {
    const result = serverToClientMessageSchema.safeParse({
      type: "foreground",
      process: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects foreground frames missing the process field", () => {
    const result = serverToClientMessageSchema.safeParse({
      type: "foreground",
    });
    expect(result.success).toBe(false);
  });

  it("rejects oversized foreground payloads", () => {
    const oversized = "a".repeat(MAX_FOREGROUND_LENGTH + 1);
    const result = serverToClientMessageSchema.safeParse({
      type: "foreground",
      process: oversized,
    });
    expect(result.success).toBe(false);
  });

  it("accepts a caffeinate state frame", () => {
    const result = serverToClientMessageSchema.safeParse({
      type: "caffeinate",
      supported: true,
      active: true,
      mode: "automatic",
      activityGate: true,
      peerKeepAwake: true,
      peerActive: false,
      batteryThreshold: 20,
      defaultCommands: ["claude", "codex"],
      commands: ["ollama"],
      activeTrigger: "claude",
    });
    expect(result.success).toBe(true);
  });

  it("rejects caffeinate state frames missing fields", () => {
    expect(
      serverToClientMessageSchema.safeParse({ type: "caffeinate", active: true, supported: true })
        .success,
    ).toBe(false);
  });

  it("accepts a git-branch-pr frame with a merged PR", () => {
    const result = serverToClientMessageSchema.safeParse({
      type: "git-branch-pr",
      pr: {
        number: 42,
        title: "Fix",
        baseRefName: "main",
        baseRef: "origin/main",
        url: "https://github.com/o/r/pull/42",
        state: "merged",
        isDraft: false,
        mergeable: "mergeable",
        mergedAt: "2024-01-01T00:00:00.000Z",
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts a git-branch-pr frame with null (no PR)", () => {
    expect(serverToClientMessageSchema.safeParse({ type: "git-branch-pr", pr: null }).success).toBe(
      true,
    );
  });

  it("rejects git-branch-pr frames missing the pr field", () => {
    expect(serverToClientMessageSchema.safeParse({ type: "git-branch-pr" }).success).toBe(false);
  });

  it("accepts a fonts state frame", () => {
    const result = serverToClientMessageSchema.safeParse({
      type: "fonts",
      activeFontId: "geist-mono",
      customFontFamily: "",
      nerdFontEnabled: false,
      ligaturesEnabled: false,
      initialized: true,
    });
    expect(result.success).toBe(true);
  });

  it("rejects fonts frames missing a toggle", () => {
    expect(
      serverToClientMessageSchema.safeParse({
        type: "fonts",
        activeFontId: "geist-mono",
        customFontFamily: "",
        nerdFontEnabled: false,
        ligaturesEnabled: false,
      }).success,
    ).toBe(false);
  });
});

describe("font input schemas", () => {
  it("updateFontsInputSchema accepts a single-field partial", () => {
    expect(updateFontsInputSchema.safeParse({ activeFontId: "custom" }).success).toBe(true);
    expect(updateFontsInputSchema.safeParse({ nerdFontEnabled: true }).success).toBe(true);
  });

  it("updateFontsInputSchema rejects an empty update", () => {
    expect(updateFontsInputSchema.safeParse({}).success).toBe(false);
  });

  it("updateFontsInputSchema rejects an unknown field (strict)", () => {
    expect(updateFontsInputSchema.safeParse({ bogus: 1 }).success).toBe(false);
  });

  it("migrateFontsInputSchema requires all four fields", () => {
    expect(
      migrateFontsInputSchema.safeParse({
        activeFontId: "custom",
        customFontFamily: "MesloLGS NF",
        nerdFontEnabled: true,
        ligaturesEnabled: false,
      }).success,
    ).toBe(true);
    expect(migrateFontsInputSchema.safeParse({ activeFontId: "custom" }).success).toBe(false);
  });
});
