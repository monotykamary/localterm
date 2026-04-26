import { describe, expect, it } from "vitest";
import { MAX_INPUT_BYTES } from "./constants.js";
import {
  clientToServerMessageSchema,
  createSessionInputSchema,
  serverToClientMessageSchema,
} from "./schemas.js";

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

describe("createSessionInputSchema", () => {
  it("accepts an empty body", () => {
    expect(createSessionInputSchema.safeParse({}).success).toBe(true);
  });

  it("accepts known fields", () => {
    const result = createSessionInputSchema.safeParse({
      cwd: "/tmp",
      shell: "/bin/zsh",
      cols: 80,
      rows: 24,
      env: { FOO: "bar" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects oversized cwd", () => {
    const result = createSessionInputSchema.safeParse({ cwd: "x".repeat(10_000) });
    expect(result.success).toBe(false);
  });

  it("rejects unknown fields", () => {
    const result = createSessionInputSchema.safeParse({ malicious: true });
    expect(result.success).toBe(false);
  });
});

describe("serverToClientMessageSchema", () => {
  it("accepts every variant", () => {
    expect(
      serverToClientMessageSchema.safeParse({
        type: "snapshot",
        data: "x",
        cols: 80,
        rows: 24,
        title: "shell",
      }).success,
    ).toBe(true);
    expect(serverToClientMessageSchema.safeParse({ type: "output", data: "x" }).success).toBe(true);
    expect(serverToClientMessageSchema.safeParse({ type: "title", title: "x" }).success).toBe(true);
    expect(serverToClientMessageSchema.safeParse({ type: "exit", code: 0 }).success).toBe(true);
    expect(serverToClientMessageSchema.safeParse({ type: "exit", code: null }).success).toBe(true);
  });
});
