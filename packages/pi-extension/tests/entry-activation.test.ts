import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const activation = vi.hoisted(() => vi.fn());
vi.mock("../extensions/activation.js", () => ({ activate: activation }));

const { default: localtermExtension } = await import("../extensions/index.js");
const originalLocalterm = process.env.LOCALTERM;

afterEach(() => {
  activation.mockReset();
  if (originalLocalterm === undefined) delete process.env.LOCALTERM;
  else process.env.LOCALTERM = originalLocalterm;
});

describe("extension entry", () => {
  it("does not activate the implementation outside localterm", async () => {
    delete process.env.LOCALTERM;
    await localtermExtension({} as never);
    expect(activation).not.toHaveBeenCalled();
  });

  it("activates before the async factory resolves inside localterm", async () => {
    process.env.LOCALTERM = "1";
    let resolved = false;
    const factory = localtermExtension({} as never).then(() => {
      resolved = true;
    });
    expect(resolved).toBe(false);
    await factory;
    expect(activation).toHaveBeenCalledOnce();
    expect(resolved).toBe(true);
  });
});
