import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { TerminalQueryResponder } from "../../src/utils/terminal-query-responder.js";

const DA1_REQUEST = "\x1b[c";
const DA1_REQUEST_ZERO = "\x1b[0c";
const DA1_RESPONSE = "\x1b[?62;4;9;22c";
const DA2_REQUEST = "\x1b[>c";
const DA2_REQUEST_ZERO = "\x1b[>0c";
const DA2_RESPONSE = "\x1b[>0;276;0c";
const KITTY_CAPABILITY_QUERY = "\x1b_Gi=31,s=1,v=1,a=q,t=d,f=24;AAAA\x1b\\";

describe("TerminalQueryResponder.interceptRequest", () => {
  let responder: TerminalQueryResponder;

  beforeEach(() => {
    responder = new TerminalQueryResponder();
  });

  afterEach(() => {
    responder.reset();
  });

  it("passes a standalone request through when the cache is cold", () => {
    const { passthrough, responses } = responder.interceptRequest(DA1_REQUEST);
    expect(passthrough).toBe(DA1_REQUEST);
    expect(responses).toEqual([]);
  });

  it("removes a standalone DA1 request and answers from cache once warmed", () => {
    responder.captureResponse(DA1_RESPONSE);
    const { passthrough, responses } = responder.interceptRequest(DA1_REQUEST);
    expect(passthrough).toBe("");
    expect(responses).toEqual([DA1_RESPONSE]);
  });

  it("answers both CSI c and CSI 0 c forms of DA1 identically", () => {
    responder.captureResponse(DA1_RESPONSE);
    const bare = responder.interceptRequest(DA1_REQUEST);
    const zero = responder.interceptRequest(DA1_REQUEST_ZERO);
    expect(bare.responses).toEqual([DA1_RESPONSE]);
    expect(zero.responses).toEqual([DA1_RESPONSE]);
    expect(bare.passthrough).toBe("");
    expect(zero.passthrough).toBe("");
  });

  it("removes a standalone DA2 request and answers from cache once warmed", () => {
    responder.captureResponse(DA2_RESPONSE);
    const { passthrough, responses } = responder.interceptRequest(DA2_REQUEST);
    expect(passthrough).toBe("");
    expect(responses).toEqual([DA2_RESPONSE]);
  });

  it("answers both CSI > c and CSI > 0 c forms of DA2 identically", () => {
    responder.captureResponse(DA2_RESPONSE);
    const bare = responder.interceptRequest(DA2_REQUEST);
    const zero = responder.interceptRequest(DA2_REQUEST_ZERO);
    expect(bare.responses).toEqual([DA2_RESPONSE]);
    expect(zero.responses).toEqual([DA2_RESPONSE]);
  });

  it("preserves response order across interleaved DA1/DA2 in one chunk", () => {
    responder.captureResponse(DA1_RESPONSE);
    responder.captureResponse(DA2_RESPONSE);
    const { responses } = responder.interceptRequest(`${DA1_REQUEST}${DA2_REQUEST}${DA1_REQUEST}`);
    expect(responses).toEqual([DA1_RESPONSE, DA2_RESPONSE, DA1_RESPONSE]);
  });

  it("leaves mixed output whole instead of moving its DA response ahead", () => {
    responder.captureResponse(DA1_RESPONSE);
    const data = `\x1b[1;31mred${DA1_REQUEST}\x1b[0m text`;
    const { passthrough, responses } = responder.interceptRequest(data);
    expect(passthrough).toBe(data);
    expect(responses).toEqual([]);
  });

  it("keeps a DA barrier behind the preceding Kitty capability query", () => {
    responder.captureResponse(DA1_RESPONSE);
    const data = `${KITTY_CAPABILITY_QUERY}${DA1_REQUEST}`;
    const { passthrough, responses } = responder.interceptRequest(data);
    expect(passthrough).toBe(data);
    expect(responses).toEqual([]);
  });

  it("does not match a DA1 response (CSI ? ... c) as a request", () => {
    responder.captureResponse(DA1_RESPONSE);
    const { passthrough, responses } = responder.interceptRequest(DA1_RESPONSE);
    expect(passthrough).toBe(DA1_RESPONSE);
    expect(responses).toEqual([]);
  });

  it("does not match other CSI sequences ending in c-adjacent bytes", () => {
    responder.captureResponse(DA1_RESPONSE);
    // SGR with a `c`-less final, and a DA3 request (CSI = c, which xterm does
    // not answer) must both pass through untouched.
    const { passthrough, responses } = responder.interceptRequest("\x1b[1;2;3m\x1b[=c\x1b[?25h");
    expect(passthrough).toBe("\x1b[1;2;3m\x1b[=c\x1b[?25h");
    expect(responses).toEqual([]);
  });

  it("passes a split request through (no partial-match corruption)", () => {
    responder.captureResponse(DA1_RESPONSE);
    // The trailing ESC [ is an incomplete CSI; it must not be eaten, and the
    // next chunk completes it as a non-DA sequence so nothing is removed.
    const first = responder.interceptRequest("text\x1b[");
    const second = responder.interceptRequest("0m");
    expect(first.passthrough).toBe("text\x1b[");
    expect(first.responses).toEqual([]);
    expect(second.passthrough).toBe("0m");
    expect(second.responses).toEqual([]);
  });
});

describe("TerminalQueryResponder.captureResponse", () => {
  let responder: TerminalQueryResponder;

  beforeEach(() => {
    responder = new TerminalQueryResponder();
  });

  afterEach(() => {
    responder.reset();
  });

  it("captures the first DA1 response and ignores later ones", () => {
    responder.captureResponse(`keys${DA1_RESPONSE}more`);
    const first = responder.interceptRequest(DA1_REQUEST);
    expect(first.responses).toEqual([DA1_RESPONSE]);
    // A different DA1 response (different capability flags) does not overwrite
    // the captured one — the first answer is authoritative for the build.
    responder.captureResponse("\x1b[?62;4;6;22c");
    const second = responder.interceptRequest(DA1_REQUEST);
    expect(second.responses).toEqual([DA1_RESPONSE]);
  });

  it("captures DA1 and DA2 independently from the same input", () => {
    responder.captureResponse(`${DA1_RESPONSE}${DA2_RESPONSE}`);
    const out = responder.interceptRequest(`${DA1_REQUEST}${DA2_REQUEST}`);
    expect(out.responses).toEqual([DA1_RESPONSE, DA2_RESPONSE]);
  });

  it("ignores plain keystrokes (no false capture)", () => {
    responder.captureResponse("ls -la\n");
    const { passthrough, responses } = responder.interceptRequest(DA1_REQUEST);
    expect(passthrough).toBe(DA1_REQUEST);
    expect(responses).toEqual([]);
  });
});
