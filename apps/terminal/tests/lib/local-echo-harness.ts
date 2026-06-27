// Wires the REAL LocalEcho to a SimulatedShell + TerminalModel over a
// fake-timer link, so scenarios can drive the actual prediction/reconcile
// code path and assert the resulting screen state against the shell's ground
// truth. The link delay (rttMs) is modeled with setTimeout; the test owns the
// clock (fake timers + performance.now) and calls `advance(ms)` to settle
// echoes. Supports three regimes: a fast burst (keystrokes at t=0, per-keystroke
// echo at rtt), a coalesced frame (echoChunkSize batches echoes into one
// reconcile call — the chunked-echo case), and spaced typing (interKeyGapMs
// advances between keystrokes so each echo lands before the next — the gate
// case).

import type { Terminal as XtermTerminal } from "@xterm/xterm";
import { LocalEcho } from "../../src/lib/local-echo";
import { SimulatedShell } from "./simulated-shell";
import { TerminalModel } from "./terminal-model";

const DIM_ON = "\x1b[2m";
const encoder = new TextEncoder();

export interface ScenarioOptions {
  keystrokes: string[];
  advance: (ms: number) => void;
  rttMs?: number;
  interKeyGapMs?: number;
  echoChunkSize?: number;
  prompt?: string;
  syntaxHighlight?: boolean;
  silent?: boolean;
  enabled?: boolean;
  safeState?: boolean;
}

export interface ScenarioHandle {
  model: TerminalModel;
  shell: SimulatedShell;
  localEcho: LocalEcho;
  dimWrites: number;
  advance: (ms: number) => void;
}

export const runScenario = (options: ScenarioOptions): ScenarioHandle => {
  const {
    keystrokes,
    advance,
    rttMs = 0,
    interKeyGapMs,
    echoChunkSize = 0,
    enabled = true,
    safeState = true,
  } = options;

  const model = new TerminalModel();
  const shell = new SimulatedShell({
    prompt: options.prompt,
    syntaxHighlight: options.syntaxHighlight,
    silent: options.silent,
  });
  model.write(shell.prompt);

  let dimWrites = 0;
  const terminalWrite = (data: string | Uint8Array): void => {
    const text = typeof data === "string" ? data : new TextDecoder().decode(data);
    if (text.includes(DIM_ON)) dimWrites += 1;
    model.write(data);
  };
  const terminal = { write: terminalWrite } as unknown as XtermTerminal;

  const sentChunks: string[] = [];
  const deliver = (chunk: string): void => {
    for (const echo of shell.feed(chunk)) {
      const bytes = localEcho.reconcile(encoder.encode(echo));
      model.write(bytes);
    }
  };

  const send = (chunk: string): void => {
    if (echoChunkSize > 0) {
      sentChunks.push(chunk);
      return;
    }
    setTimeout(() => deliver(chunk), rttMs);
  };

  const localEcho = new LocalEcho({
    terminal,
    send,
    isSafeState: () => safeState,
  });
  localEcho.setEnabled(enabled);

  for (let index = 0; index < keystrokes.length; index += 1) {
    localEcho.handleInput(keystrokes[index] ?? "");
    if (interKeyGapMs !== undefined && index < keystrokes.length - 1) advance(interKeyGapMs);
  }

  if (echoChunkSize > 0 && sentChunks.length > 0) {
    const chunks = sentChunks.slice();
    setTimeout(() => {
      const echoes: string[] = [];
      for (const chunk of chunks) echoes.push(...shell.feed(chunk));
      const batched: string[] = [];
      for (let i = 0; i < echoes.length; i += echoChunkSize) {
        batched.push(echoes.slice(i, i + echoChunkSize).join(""));
      }
      for (const echo of batched) {
        const bytes = localEcho.reconcile(encoder.encode(echo));
        model.write(bytes);
      }
    }, rttMs);
  }

  return { model, shell, localEcho, dimWrites, advance };
};
