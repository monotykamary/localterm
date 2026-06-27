// Answers the stateless terminal identity queries (DA1, DA2) server-side so the
// probing program gets an instant in-process response instead of waiting on
// the remote round-trip to xterm.js.
//
// Why: a terminal identity query is a synchronous, in-process protocol. In a
// real terminal the program writes `CSI c` (DA1) and the same process reads the
// response (`CSI ? 62;4;9;22c`) off the PTY master microseconds later. In
// localterm the terminal emulator is across a WebSocket, so the response must
// travel PTY -> server -> xterm.js (parsed asynchronously via setTimeout) ->
// server -> PTY — reliably tens of ms. A probing program that issues the query
// with a short read timeout (a prompt plugin) or that exits before the
// response arrives (neovim re-probing DA1 on a resize-driven SIGWINCH, then
// `:q`) gives up before the slow response lands, so the response is orphaned in
// the PTY stdin and the next reader treats it as typed text — `62;4;9;22c`
// leaking into the shell. Latency tuning can't win this race reliably (every
// program's timeout differs), so the fix is to answer in the same process that
// holds the PTY, the tmux/mosh model: nothing round-trips to xterm at all.
//
// Scope is deliberately a fixed, standard, stateless family: DA1 (`CSI [Ps] c`
// -> `CSI ? ... c`) and DA2 (`CSI > [Ps] c` -> `CSI > ... c`). Their responses
// depend only on terminal identity (fixed for a given xterm build), not on
// modes or colors, so a once-captured response is correct forever. DA3
// (`CSI = c`) is intentionally NOT handled: xterm.js does not answer it, so
// there is no response to orphan and nothing to replay — intercepting it would
// be dead code. Stateful queries (DECRQM mode reports, OSC color) are also out
// of scope: their responses depend on live state, answering them server-side
// would mean tracking that state, and the replay-suppression + sync-flush
// fixes already keep them from leaking in the observed paths.
//
// This is NOT the rejected server-side stripper. The stripper rewrote the
// scrollback replay to drop an open-ended set of query variants — unbounded
// (every variant enumerated) and lossy. This responder intercepts a fixed
// set of live queries with unambiguous CSI finals (final `c`, intermediate
// none = DA1 / `>` = DA2 — no other sequence has these shapes), removes exactly
// those bytes from the output so xterm never sees the request and never
// responds, and writes the cached response straight to the PTY. A request
// split across PTY chunks simply isn't matched (DA queries are single small
// writes, one per chunk), so it passes through unchanged — no corruption.

const DA_REQUEST = /\x1b\[(>?)0?c/g;

const DA1_RESPONSE = /\x1b\[\?\d+(?:;\d+)*c/;
const DA2_RESPONSE = /\x1b\[>\d+(?:;\d+)*c/;

class TerminalQueryResponder {
  // xterm.js's responses, captured the first time xterm answers each query
  // (before the cache is warm the request round-trips to xterm as it does
  // today — the round-trip is fine on a fresh spawn where the shell reads
  // patiently; the leak only happens at the switch/exit moments where the cache
  // is already warm). Once captured, every subsequent probe across every PTY
  // is answered instantly from here.
  private da1Response: string | null = null;
  private da2Response: string | null = null;

  // Scan PTY output for DA1/DA2 requests. Returns the output with matched
  // requests removed (so xterm never sees them and never responds) plus the
  // cached responses to write straight to the PTY, in order. When a cache is
  // cold the request is left in the output to round-trip to xterm (whose
  // response is then captured via captureResponse) — so the first probe ever
  // behaves exactly as it does today, and only subsequent probes are answered
  // here.
  interceptRequest = (data: string): { passthrough: string; responses: string[] } => {
    const responses: string[] = [];
    const passthrough = data.replace(DA_REQUEST, (match, intermediate) => {
      if (intermediate === ">") {
        if (this.da2Response === null) return match;
        responses.push(this.da2Response);
        return "";
      }
      if (this.da1Response === null) return match;
      responses.push(this.da1Response);
      return "";
    });
    return { passthrough, responses };
  };

  // Scan xterm's input (its query responses) for DA1/DA2 and cache the first
  // seen of each. Non-destructive: it only reads. Called on every input frame,
  // so the scan is a cheap regex against a short string (a DA response is under
  // 30 bytes and arrives alone in its own input message — xterm emits query
  // responses as separate onData events from keystrokes).
  captureResponse = (data: string): void => {
    if (this.da1Response === null) {
      const da1 = data.match(DA1_RESPONSE);
      if (da1) this.da1Response = da1[0];
    }
    if (this.da2Response === null) {
      const da2 = data.match(DA2_RESPONSE);
      if (da2) this.da2Response = da2[0];
    }
  };

  // Test-only: reset the cache between cases so the process-global singleton
  // doesn't leak state across tests.
  reset = (): void => {
    this.da1Response = null;
    this.da2Response = null;
  };
}

const terminalQueryResponder = new TerminalQueryResponder();

export { TerminalQueryResponder, terminalQueryResponder };
