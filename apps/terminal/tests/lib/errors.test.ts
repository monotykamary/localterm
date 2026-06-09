import { describe, expect, it } from "vite-plus/test";
import {
  WS_CLOSE_BACKPRESSURE,
  WS_CLOSE_CAPACITY_REACHED,
  WS_CLOSE_POLICY_VIOLATION,
} from "@monotykamary/localterm-server/protocol";
import {
  WebErrorException,
  formatWebError,
  isWebErrorException,
  webError,
  type WebError,
} from "../../src/lib/errors";

const allVariants = (): WebError[] => [
  webError.connectionLost(3),
  webError.shellExited(0),
  webError.shellExited(137),
  webError.shellExited(null),
  webError.socketRefusedByServer(WS_CLOSE_POLICY_VIOLATION),
  webError.socketRefusedByServer(WS_CLOSE_CAPACITY_REACHED),
  webError.socketRefusedByServer(WS_CLOSE_BACKPRESSURE),
  webError.socketRefusedByServer(4999),
  webError.frameInvalid("json-parse"),
  webError.frameInvalid("schema-parse"),
  webError.storageDenied("localStorage", "read"),
  webError.storageDenied("sessionStorage", "write"),
  webError.clipboardDenied(),
];

describe("webError vocabulary", () => {
  it("every variant has a stable E_LT_WEB_* code", () => {
    for (const variant of allVariants()) {
      expect(variant.code.startsWith("E_LT_WEB_")).toBe(true);
    }
  });

  it("classifyCloseCode maps shared protocol close codes onto reasons", () => {
    expect(webError.socketRefusedByServer(WS_CLOSE_POLICY_VIOLATION).reason).toBe(
      "loopback-policy",
    );
    expect(webError.socketRefusedByServer(WS_CLOSE_CAPACITY_REACHED).reason).toBe(
      "session-capacity",
    );
    expect(webError.socketRefusedByServer(WS_CLOSE_BACKPRESSURE).reason).toBe("backpressure");
    expect(webError.socketRefusedByServer(4999).reason).toBe("unknown");
  });
});

describe("formatWebError", () => {
  it("formats every variant without throwing the exhaustiveness guard", () => {
    for (const variant of allVariants()) {
      const message = formatWebError(variant);
      expect(message).toBeTypeOf("string");
      expect(message.length).toBeGreaterThan(0);
    }
  });

  it("distinguishes shell-exited messages by the exit code shape", () => {
    expect(formatWebError(webError.shellExited(null))).toContain("Shell ended");
    expect(formatWebError(webError.shellExited(137))).toContain("137");
  });

  it("renders close-code-specific text for the three known refusal reasons", () => {
    expect(formatWebError(webError.socketRefusedByServer(WS_CLOSE_POLICY_VIOLATION))).toMatch(
      /loopback/i,
    );
    expect(formatWebError(webError.socketRefusedByServer(WS_CLOSE_CAPACITY_REACHED))).toMatch(
      /capacity/i,
    );
    expect(formatWebError(webError.socketRefusedByServer(WS_CLOSE_BACKPRESSURE))).toMatch(
      /buffered/i,
    );
    expect(formatWebError(webError.socketRefusedByServer(4999))).toContain("4999");
  });
});

describe("WebErrorException", () => {
  it("carries the typed error and is detectable via the type guard", () => {
    const exception = new WebErrorException(webError.shellExited(0));
    expect(exception).toBeInstanceOf(Error);
    expect(exception.name).toBe("WebErrorException");
    expect(exception.error.kind).toBe("shell-exited");
    expect(isWebErrorException(exception)).toBe(true);
    expect(isWebErrorException(new Error("plain"))).toBe(false);
    expect(isWebErrorException(null)).toBe(false);
  });
});
