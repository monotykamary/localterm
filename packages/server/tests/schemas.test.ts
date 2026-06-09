import { describe, expect, it } from "vite-plus/test";
import {
  MAX_FOREGROUND_LENGTH,
  MAX_INPUT_BYTES,
  MAX_OUTPUT_BYTES,
  MAX_TITLE_LENGTH,
} from "../src/constants.js";
import { clientToServerMessageSchema, serverToClientMessageSchema } from "../src/schemas.js";

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
});

describe("serverToClientMessageSchema", () => {
  it("accepts every variant", () => {
    expect(serverToClientMessageSchema.safeParse({ type: "output", data: "x" }).success).toBe(true);
    expect(serverToClientMessageSchema.safeParse({ type: "exit", code: 0 }).success).toBe(true);
    expect(serverToClientMessageSchema.safeParse({ type: "exit", code: null }).success).toBe(true);
    expect(serverToClientMessageSchema.safeParse({ type: "title", title: "shell" }).success).toBe(
      true,
    );
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

  it("rejects oversized output payloads (defense in depth against compromised servers)", () => {
    const oversized = "a".repeat(MAX_OUTPUT_BYTES + 1);
    expect(serverToClientMessageSchema.safeParse({ type: "output", data: oversized }).success).toBe(
      false,
    );
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
    });
    expect(result.success).toBe(true);
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
});
