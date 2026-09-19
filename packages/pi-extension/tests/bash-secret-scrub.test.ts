import type {
  BashOperations,
  BashToolOptions,
  ExtensionAPI,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { FABRIC_BASH_MIDDLEWARE } from "../src/constants.js";

const mocks = vi.hoisted(() => ({
  names: vi.fn(() => ["LOCALTERM_TEST_SECRET"]),
  values: vi.fn(() => ["localterm-test-secret"]),
  settings: vi.fn(() => ({ shellPath: "/configured/bash", commandPrefix: "prefix" })),
  localOperations: { exec: vi.fn<BashOperations["exec"]>() },
  createDefinition: vi.fn((_cwd: string, options: BashToolOptions) => ({ name: "bash", options })),
}));
vi.mock("../src/utils/read-localterm-secret-policy.js", () => ({
  readLocaltermSecretEnvVarsForPi: mocks.names,
}));
vi.mock("../src/utils/read-secret-values.js", () => ({
  readLocaltermSecretValuesForPi: mocks.values,
}));
vi.mock("../src/utils/read-pi-shell-settings.js", () => ({ readPiShellSettings: mocks.settings }));
vi.mock("@earendil-works/pi-coding-agent", () => ({
  createBashToolDefinition: mocks.createDefinition,
  createLocalBashOperations: () => mocks.localOperations,
}));
const { registerBashSecretScrub } = await import("../extensions/bash-secret-scrub.js");

interface Middleware {
  version: number;
  options: Omit<BashToolOptions, "operations">;
  wrapOperations: (operations: BashOperations) => BashOperations;
}
interface RegisteredDefinition extends ToolDefinition {
  options: BashToolOptions;
  [FABRIC_BASH_MIDDLEWARE]: Middleware;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.names.mockReturnValue(["LOCALTERM_TEST_SECRET"]);
  mocks.values.mockReturnValue(["localterm-test-secret"]);
  mocks.localOperations.exec.mockImplementation(async () => ({ exitCode: 0 }));
});

const install = async () => {
  const listeners = new Map<string, () => void>();
  let resolve!: (tool: RegisteredDefinition) => void;
  const ready = new Promise<RegisteredDefinition>((done) => {
    resolve = done;
  });
  const registerTool = vi.fn(resolve);
  registerBashSecretScrub({
    on: (event: string, callback: () => void) => listeners.set(event, callback),
    registerTool,
  } as unknown as ExtensionAPI);
  expect(registerTool).not.toHaveBeenCalled();
  listeners.get("session_start")!();
  const definition = await ready;
  return { definition, middleware: definition[FABRIC_BASH_MIDDLEWARE], listeners, registerTool };
};

const run = async (operations: BashOperations, chunks: Buffer[], failure?: Error) => {
  mocks.localOperations.exec.mockImplementation(async (_command, _cwd, { onData }) => {
    for (const chunk of chunks) onData(chunk);
    if (failure) throw failure;
    return { exitCode: 0 };
  });
  let text = "";
  const result = operations.exec("command", "/cwd", {
    onData: (chunk) => {
      text += chunk.toString();
    },
  });
  if (failure) await expect(result).rejects.toBe(failure);
  else await expect(result).resolves.toEqual({ exitCode: 0 });
  return text;
};

describe("Fabric bash middleware opt-in", () => {
  it("offers the public capability while retaining standalone shell protection", async () => {
    const { definition, middleware } = await install();
    expect(FABRIC_BASH_MIDDLEWARE).toBe(Symbol.for("pi-fabric:bash-middleware:v1"));
    expect(middleware.version).toBe(1);
    expect(middleware.options).toMatchObject({
      shellPath: "/configured/bash",
      commandPrefix: "prefix",
    });
    expect(definition.options.spawnHook).toBe(middleware.options.spawnHook);
    const env = { LOCALTERM_TEST_SECRET: "localterm-test-secret", PATH: "/bin" };
    expect(middleware.options.spawnHook!({ command: "cmd", cwd: "/cwd", env })).toEqual({
      command: "cmd",
      cwd: "/cwd",
      env: { PATH: "/bin" },
    });
    expect(env.LOCALTERM_TEST_SECRET).toBe("localterm-test-secret");
    expect(
      await run(definition.options.operations!, [Buffer.from("localterm-test-secret\n")]),
    ).toBe("*\n");
  });

  it("filters split UTF-8 and secret chunks before the host records them", async () => {
    const { middleware } = await install();
    const bytes = Buffer.from("π localterm-test-secret\n");
    const chunks = Array.from(bytes, (byte) => Buffer.from([byte]));
    expect(await run(middleware.wrapOperations(mocks.localOperations), chunks)).toBe("π *\n");
  });

  it("flushes only redacted buffered output on cancellation or failure", async () => {
    const { middleware } = await install();
    expect(
      await run(
        middleware.wrapOperations(mocks.localOperations),
        [Buffer.from("localterm-test-secret")],
        new Error("aborted"),
      ),
    ).toBe("*");
  });

  it("refreshes policy for existing standalone and Fabric wrappers on session transitions", async () => {
    const { middleware, definition, listeners, registerTool } = await install();
    const wrapped = middleware.wrapOperations(mocks.localOperations);
    mocks.names.mockReturnValue(["NEXT_SECRET"]);
    mocks.values.mockReturnValue(["next-test-secret"]);
    listeners.get("session_start")!();
    expect(registerTool).toHaveBeenCalledOnce();
    const env = { LOCALTERM_TEST_SECRET: "old", NEXT_SECRET: "next-test-secret" };
    expect(middleware.options.spawnHook!({ command: "cmd", cwd: "/cwd", env }).env).toEqual({
      LOCALTERM_TEST_SECRET: "old",
    });
    for (const operations of [wrapped, definition.options.operations!]) {
      expect(await run(operations, [Buffer.from("next-test-secret")])).toBe("*");
    }
  });

  it("passes through unchanged with no configured secrets", async () => {
    mocks.names.mockReturnValue([]);
    mocks.values.mockReturnValue([]);
    const { middleware } = await install();
    const env = { PATH: "/bin" };
    expect(middleware.options.spawnHook!({ command: "cmd", cwd: "/cwd", env }).env).toBe(env);
    expect(
      await run(middleware.wrapOperations(mocks.localOperations), [Buffer.from("unaltered")]),
    ).toBe("unaltered");
  });
});
