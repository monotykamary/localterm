import { describe, expect, it } from "vite-plus/test";

import { TerminalReplayBuffer } from "../../src/utils/terminal-replay-buffer.js";

const ESCAPE = "\x1b";

describe("TerminalReplayBuffer", () => {
  it("retains a newest chunk even when it exceeds the byte budget", () => {
    const replay = new TerminalReplayBuffer(4);
    replay.append("old");
    replay.append("newest");

    expect(replay.snapshot()).toBe("newest");
  });

  it("drops an APC continuation when eviction removed its opener", () => {
    const replay = new TerminalReplayBuffer(8);
    replay.append(`${ESCAPE}_Ga=T;AAAAAAAA`);
    replay.append("BBBB");
    replay.append(`${ESCAPE}\\tail`);
    replay.append("safe");

    expect(replay.snapshot()).toBe("safe");
  });

  it("retains complete APC commands and recognizes BEL termination", () => {
    const replay = new TerminalReplayBuffer(100);
    replay.append(`${ESCAPE}_Gpayload${ESCAPE}\\after`);
    replay.append(`${ESCAPE}_pi:c`);
    replay.append("\x07next");

    expect(replay.snapshot()).toBe(`${ESCAPE}_Gpayload${ESCAPE}\\after${ESCAPE}_pi:c\x07next`);
  });
});
