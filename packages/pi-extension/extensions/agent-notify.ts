import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { AGENT_NOTIFY_MIN_ELAPSED_MS } from "../src/constants.js";
import { formatAgentEndBody } from "../src/utils/agent-notify-body.js";
import { buildOsc9Sequence } from "../src/utils/osc-sequence.js";

// pi's only notification primitive is ctx.ui.notify — an in-TUI banner that's
// invisible the moment you switch away from the pi tab. localterm already has
// a desktop-notification pipeline: anything writing an OSC 9 sequence
// (ESC ] 9 ; MESSAGE BEL) to the PTY is parsed by the localterm daemon and
// broadcast to every attached web client, which shows an OS notification when
// the user enabled "Desktop alerts". pi runs inside that PTY, so this bridges
// the two by writing an OSC 9 on agent_end.
//
// Threshold-gated (AGENT_NOTIFY_MIN_ELAPSED_MS) so quick back-and-forth turns
// don't spam a user watching the pi tab — only turns long enough that the user
// likely stepped away ping. Not error-gated: pi's bash tool flags every
// non-zero exit as an error, so an "always notify on error" rule would fire
// on every failed test/build and defeat the threshold. Guarded to TUI mode
// because in json/rpc/print mode pi's stdout is the protocol/answer stream,
// and an OSC 9 injected there is binary garbage (and a pointless desktop ping
// for a non-human consumer).
export const registerAgentNotify = (pi: ExtensionAPI): void => {
  let turnStartedAt: number | undefined;

  pi.on("agent_start", () => {
    turnStartedAt = Date.now();
  });

  pi.on("agent_end", (_event, ctx) => {
    if (ctx.mode !== "tui" || turnStartedAt === undefined) return;
    const elapsedMs = Date.now() - turnStartedAt;
    if (elapsedMs < AGENT_NOTIFY_MIN_ELAPSED_MS) return;
    const body = formatAgentEndBody(elapsedMs, pi.getSessionName());
    process.stdout.write(buildOsc9Sequence(body));
  });
};
