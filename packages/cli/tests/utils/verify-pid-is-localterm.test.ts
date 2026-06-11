import { afterEach, describe, expect, it } from "vite-plus/test";
import { DAEMON_PROCESS_TITLE } from "../../src/constants.js";
import { verifyPidIsLocalterm } from "../../src/utils/verify-pid-is-localterm.js";

const originalProcessTitle = process.title;

afterEach(() => {
  process.title = originalProcessTitle;
});

describe("verifyPidIsLocalterm", () => {
  it("returns 'not-ours' for non-positive or non-integer pids", async () => {
    expect(await verifyPidIsLocalterm(0)).toBe("not-ours");
    expect(await verifyPidIsLocalterm(-1)).toBe("not-ours");
    expect(await verifyPidIsLocalterm(Number.NaN)).toBe("not-ours");
    expect(await verifyPidIsLocalterm(1.5)).toBe("not-ours");
  });

  it("returns 'unknown' for a pid that cannot be probed", async () => {
    expect(await verifyPidIsLocalterm(2_147_483_640)).toBe("unknown");
  });

  it("returns 'not-ours' for a live process whose comm is not the daemon title", async () => {
    expect(await verifyPidIsLocalterm(process.pid)).toBe("not-ours");
  });

  it("returns 'ours' for a live process whose comm matches the daemon title", async () => {
    process.title = DAEMON_PROCESS_TITLE;
    expect(await verifyPidIsLocalterm(process.pid)).toBe("ours");
  });
});
