#!/usr/bin/env node
// Discrete-event simulation of the localterm client render pipeline.
//
// Compares three pipelines against each scenario:
//
//   raw        — SHIPPED. Flush every WebSocket message on arrival (raw in/out).
//                The server coalesces one burst per message and caps a message
//                at 64KB, so a frame <= 64KB arrives as one atomic message
//                (one render, no crawl). A frame > 64KB is split by the cap;
//                over a bandwidth-limited link the splits land across vsyncs
//                and each renders -> a top-to-bottom crawl.
//   debounce   — PRE-RAW-IN-OUT backstop. Stage and flush 4ms after the LAST
//                arrival (a resetting timer). On a fast link a split frame's
//                messages land within the window -> one render; on a slow link
//                they spread past it -> one flush per split -> crawl (== raw).
//   frameskip   — DEFERRED ideal. The server marks the frame end; the client
//                stages by frame until the marker, then commits the whole
//                frame in ONE write -> one complete render regardless of split
//                size or link bandwidth (the complete Face 1 fix).
//
//   Face 1 — a single large TUI redraw, split into ~64KB WebSocket messages by
//            the server's cap, arrives spread over a bandwidth-limited link.
//            raw/debounce render each split as it lands -> visible crawl.
//            frameskip renders the whole frame once.
//   Face 2 — a single write whose parse exceeds xterm's 12ms WriteBuffer budget
//            yields via setTimeout(0); renders fire between parse chunks
//            painting partial state -> smooth-fps visual stutter. frameskip
//            gates the render to complete writes -> one complete paint.
//   Throughput + keyboard — a sustained stream must not make keystroke echo
//            unresponsive. Measures echo render latency and render FPS.
//
// The model captures the SCHEDULING architecture (rAF/vsync boundaries, the
// 12ms parse-chunk budget, setTimeout(0) yields, single main-thread
// serialization, network bandwidth+latency delivery) — which is where these
// concerns live — not the xterm byte parser. The render is modeled as firing
// at every vsync while output is active ("smooth fps"); a paint records the
// cumulative-parsed fraction of the frame being drawn, so a paint with
// fraction < 1 is a visible partial (Face 2 / a progressive crawl step in
// Face 1).

const RAF_MS = 1000 / 60; // 16.667
const BUDGET_MS = 12; // xterm WriteBuffer parse-chunk budget
const TIMEOUT_ZERO_MS = 4; // setTimeout(0) clamp between parse chunks
export const SERVER_BATCH_FLUSH_BYTES = 64 * 1024; // server 64KB cap (our shipped value)
const IDLE_DEBOUNCE_MS = 4; // pre-raw-in-out client idle-debounce backstop
const PARSE_RATE = 50_000; // bytes/ms (50 MB/s); realistic xterm parse rate.
// A ~100KB redraw parses inside one budget (instant on LAN); a 2MB dump yields.
const RENDER_DURATION_MS = 0.4; // a render occupies the main thread briefly
const FLUSH_DURATION_MS = 0.05; // terminal.write() call plumbing
const FRAME_SKIP_RATE_CAP_MS = 16; // frame-skip stream coalesce window
const FRAME_SKIP_SIZE_CAP_BYTES = BUDGET_MS * PARSE_RATE; // cap a flush so its
// parse never exceeds the budget -> no parse-yield on the stream path.
const STREAM_FRAME_ID = -1; // synthetic frame id for rate-capped stream flushes

const nextVsync = (t) => {
  // smallest vsync (k*RAF_MS, k>=1) that is at-or-after t, snapping when t is
  // essentially on a vsync. Must never return a value < t (that re-schedules
  // rafs into the past and loops the deferral).
  const k = Math.round(t / RAF_MS);
  const v = k * RAF_MS;
  if (v + 1e-6 >= t && k >= 1) return v;
  return Math.max(1, Math.ceil(t / RAF_MS)) * RAF_MS;
};

// --- min-heap of events keyed by (t, pri, seq) ------------------------------
class Heap {
  constructor() {
    this.a = [];
  }
  get size() {
    return this.a.length;
  }
  push(item) {
    const a = this.a;
    let i = a.length;
    a.push(item);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (cmp(a[p], a[i]) <= 0) break;
      const tmp = a[p];
      a[p] = a[i];
      a[i] = tmp;
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const n = a.length;
    if (!n) return undefined;
    const top = a[0];
    const last = a.pop();
    if (n > 1) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let s = i;
        if (l < a.length && cmp(a[l], a[s]) < 0) s = l;
        if (r < a.length && cmp(a[r], a[s]) < 0) s = r;
        if (s === i) break;
        const tmp = a[s];
        a[s] = a[i];
        a[i] = tmp;
        i = s;
      }
    }
    return top;
  }
}
const cmp = (x, y) => (x.t !== y.t ? x.t - y.t : x.pri - y.pri || x.seq - y.seq);

// --- the single-threaded event loop ----------------------------------------
class Sim {
  constructor() {
    this.heap = new Heap();
    this.clock = 0;
    this.busyUntil = 0;
    this.seq = 0;
    this.slots = { flush: { pending: false, fn: null }, render: { pending: false, fn: null } };
    this.rafEvents = 0;
  }
  schedule(t, pri, kind, data) {
    this.heap.push({ t, pri, seq: this.seq++, kind, data });
  }
  arrival(at, fn) {
    this.schedule(at, 0, "task", fn);
  }
  timeout(at, fn) {
    this.schedule(at, 1, "task", fn);
  }
  requestRaf(slot, fn) {
    const sl = this.slots[slot];
    if (sl.pending) return;
    sl.pending = true;
    sl.fn = fn;
    this.schedule(nextVsync(this.clock), 2, "raf", slot);
  }
  occupy(dur) {
    this.busyUntil = this.clock + dur;
  }
  run() {
    let guard = 0;
    while (this.heap.size) {
      if (++guard > 200000) {
        const peek = [];
        for (let i = 0; i < 8 && this.heap.size; i++) peek.push(this.heap.pop());
        for (const e of peek) this.heap.push(e);
        throw new Error(
          `sim runaway: ${this.heap.size} left, clock=${this.clock.toFixed(3)} busy=${this.busyUntil.toFixed(3)} slots=${JSON.stringify(Object.fromEntries(Object.entries(this.slots).map(([k, v]) => [k, v.pending])))}
next: ${peek.map((e) => `t=${e.t.toFixed(2)} pri=${e.pri} ${e.kind}${e.kind === "raf" ? `(${e.data})` : "(task)"}`).join(" | ")}`,
        );
      }
      const ev = this.heap.pop();
      if (ev.kind === "raf") {
        const sl = this.slots[ev.data];
        if (this.busyUntil > ev.t + 1e-9) {
          this.schedule(nextVsync(this.busyUntil), 2, "raf", ev.data);
          continue;
        }
        sl.pending = false;
        this.clock = ev.t;
        this.busyUntil = ev.t + RENDER_DURATION_MS;
        this.rafEvents += 1;
        sl.fn(ev.t);
      } else {
        const start = Math.max(ev.t, this.busyUntil);
        this.clock = start;
        ev.data(start);
      }
    }
  }
}

// --- pipeline runner -------------------------------------------------------
// A "frame" is a logical terminal redraw of totalBytes, split into chunks that
// arrive over the link. frames: Map<id, {totalBytes, arrived, parsed, allArrived,
// allParsed, firstSendT, completeRenderT}>.
export const runPipeline = (mode, arrivals, opts) => {
  const sim = new Sim();
  const frames = new Map();
  const metrics = {
    renders: [], // {t, frameId, fraction, complete}
    echoCommittedT: null,
    completions: 0,
    flushes: 0,
  };

  const getFrame = (id, totalBytes, sendT) => {
    let f = frames.get(id);
    if (!f) {
      f = {
        totalBytes,
        arrived: 0,
        parsed: 0,
        allArrived: false,
        allParsed: false,
        firstSendT: sendT,
        completeRenderT: null,
        stream: false,
        committed: 0,
        echo: false,
      };
      frames.set(id, f);
    }
    return f;
  };

  const recordRender = (t, frameId, fraction, complete) => {
    metrics.renders.push({ t, frameId, fraction, complete });
    const f = frames.get(frameId);
    if (complete && f && f.completeRenderT === null) f.completeRenderT = t;
  };

  let lastCompleted = null; // {frameId, seq, t} — most recent fully-parsed write
  let lastRenderedSeq = -1; // for frameskip dedup
  let completionSeq = 0;
  let activeFrameId = null; // frame currently being parsed (current-mode partials)

  // write() -> parse (WriteBuffer: BUDGET_MS chunks, setTimeout(0) yields).
  // Each chunk advances frame.parsed (cumulative, incl. in-flight) and marks
  // dirty (schedules a render raf). On a write's completion, commit its bytes
  // to the frame (f.committed) and bump completionSeq (frameskip render signal).
  const write = (bytes, frameId) => {
    activeFrameId = frameId;
    const parseMs = bytes / PARSE_RATE;
    const chunks = Math.max(1, Math.ceil(parseMs / BUDGET_MS));
    const perChunk = bytes / chunks;
    let remaining = parseMs;
    const parseChunk = () => {
      const dur = Math.min(BUDGET_MS, remaining);
      sim.occupy(dur);
      sim.clock = sim.busyUntil;
      remaining -= dur;
      const f = frames.get(frameId);
      if (f) {
        f.parsed = f.parsed + perChunk;
        if (remaining <= 1e-9) {
          f.allParsed = true;
          f.committed = f.parsed; // commit this write's bytes
          lastCompleted = { frameId, seq: ++completionSeq, t: sim.clock };
          metrics.completions += 1;
          if (f.echo) {
            metrics.echoCommittedT = sim.clock;
            // interactive fast-path: render the echo immediately (a task, not
            // the gated/deferred raf) so a keystroke paints as soon as its
            // parse lands instead of waiting for a vsync the saturated stream
            // never frees.
            sim.timeout(sim.clock, () => doRender(sim.clock));
          }
        }
      }
      sim.requestRaf("render", (rt) => doRender(rt));
      if (remaining > 1e-9) {
        sim.timeout(sim.clock + TIMEOUT_ZERO_MS, parseChunk);
      }
    };
    sim.timeout(sim.clock + TIMEOUT_ZERO_MS, parseChunk);
  };

  // render slot callback.
  //  raw/debounce: paint cumulative-parsed of the active write every vsync
  //    while output is active -> a partial until the write completes (Face 2
  //    stutter, Face 1 crawl step per split).
  //  FRAME-SKIP: paint the latest COMPLETED write at vsync, skipping in-progress
  //    parses (no partials) and never starving under sustained throughput
  //    (renders once per vsync in which a new write committed).
  const doRender = (t) => {
    if (mode === "frameskip") {
      if (!lastCompleted || lastCompleted.seq === lastRenderedSeq) return;
      recordRender(t, lastCompleted.frameId, 1, true);
      lastRenderedSeq = lastCompleted.seq;
      return;
    }
    // raw/debounce: paint the active write's cumulative parsed (partial until done)
    const f = activeFrameId !== null ? frames.get(activeFrameId) : null;
    if (!f) return;
    const complete = f.allParsed && f.allArrived;
    const fraction = f.totalBytes ? Math.min(1, f.parsed / f.totalBytes) : 1;
    recordRender(t, activeFrameId, fraction, complete);
  };

  // --- per-mode arrival handling -----------------------------------------
  // CURRENT: OutputBatcher. Accumulate chunks; sync-flush if <= threshold,
  // else rAF-coalesce then flush. (Two vsync slots: flush + render.)
  if (mode === "raw") {
    // raw in/out (shipped): flush every arrival immediately as its own write.
    // No coalescing — the server is expected to send one atomic frame per
    // message (it coalesces a burst and caps at SERVER_BATCH_FLUSH_BYTES). A
    // frame split across messages therefore renders each split -> a
    // progressive crawl on a link that spreads the splits (Face 1).
    for (const a of arrivals) {
      const f = getFrame(a.frameId, a.frameBytes, a.sendT);
      if (a.echo) f.echo = true;
      sim.arrival(a.arrivalT, (t) => {
        f.arrived += a.bytes;
        if (a.isLast) f.allArrived = true;
        sim.occupy(FLUSH_DURATION_MS);
        write(a.bytes, a.frameId);
      });
    }
  } else if (mode === "debounce") {
    // pre-raw-in-out client: stage and flush IDLE_DEBOUNCE_MS after the LAST
    // arrival (a resetting timer) — coalesces a burst that arrives within the
    // window into one write. On a fast link a split frame's messages land
    // within the window -> one render (no crawl); on a slow link they spread
    // past it -> one flush per split -> crawl (same as raw).
    let pendingAccum = 0;
    let bufferedFrame = null;
    let debounceGen = 0;
    const realFlush = (gen) => {
      if (gen !== debounceGen) return; // a newer arrival re-armed this timer
      if (pendingAccum <= 0) return;
      const fid = bufferedFrame;
      const bytes = pendingAccum;
      pendingAccum = 0;
      bufferedFrame = null;
      sim.occupy(FLUSH_DURATION_MS);
      write(bytes, fid);
    };
    for (const a of arrivals) {
      const f = getFrame(a.frameId, a.frameBytes, a.sendT);
      if (a.echo) f.echo = true;
      sim.arrival(a.arrivalT, (t) => {
        f.arrived += a.bytes;
        if (a.isLast) f.allArrived = true;
        pendingAccum += a.bytes;
        bufferedFrame = a.frameId;
        const gen = ++debounceGen;
        sim.timeout(t + IDLE_DEBOUNCE_MS, () => realFlush(gen));
      });
    }
  } else {
    // FRAME-SKIP: staging buffer, one vsync slot (render, gated to idle).
    //  - frame chunks (a.stream === false): stage per frameId until the
    //    frame-end marker (isLast), then commit the whole frame in ONE write.
    //  - stream chunks (a.stream === true): coalesce on a rate-cap + size-cap
    //    timer; each flush is a complete render unit.
    //  - echo (small, isLast, frame): flushes immediately (fast path).
    const frameStaging = new Map();
    let streamStaging = 0;
    let streamTimer = null;
    const flushFrame = (fid) => {
      const bytes = frameStaging.get(fid) ?? 0;
      if (bytes <= 0) return;
      frameStaging.delete(fid);
      sim.occupy(FLUSH_DURATION_MS);
      write(bytes, fid);
    };
    const flushStream = () => {
      streamTimer = null;
      if (streamStaging <= 0) return;
      metrics.flushes += 1;
      const bytes = streamStaging;
      streamStaging = 0;
      // model each rate-capped flush as its own complete stream frame
      const sf = getFrame(STREAM_FRAME_ID, bytes, sim.clock);
      sf.stream = true;
      sf.totalBytes = bytes;
      sf.parsed = 0;
      sf.allParsed = false;
      sf.allArrived = true;
      sim.occupy(FLUSH_DURATION_MS);
      write(bytes, STREAM_FRAME_ID);
    };
    for (const a of arrivals) {
      const f = getFrame(a.frameId, a.frameBytes, a.sendT);
      if (a.stream) f.stream = true;
      if (a.echo) f.echo = true;
      sim.arrival(a.arrivalT, (t) => {
        f.arrived += a.bytes;
        if (a.isLast) f.allArrived = true;
        if (a.stream) {
          streamStaging += a.bytes;
          if (streamStaging >= FRAME_SKIP_SIZE_CAP_BYTES) {
            flushStream();
          } else if (streamTimer === null) {
            streamTimer = "pending";
            sim.timeout(t + FRAME_SKIP_RATE_CAP_MS, flushStream);
          }
        } else {
          frameStaging.set(a.frameId, (frameStaging.get(a.frameId) ?? 0) + a.bytes);
          if (a.isLast) flushFrame(a.frameId); // atomic frame commit
        }
      });
    }
  }

  sim.run();
  return { frames, metrics, sim };
};

// --- arrival planner (link: latency + bandwidth + ratio, single serial queue) ---
// `ratio` is the WebSocket permessage-deflate compression ratio (ANSI TUI output
// compresses ~4x at level 3): the wire bytes are bytes/ratio, so the effective
// bandwidth is bandwidth * ratio.
export const planArrivals = (sends, link) => {
  const sorted = [...sends].sort((a, b) => a.sendT - b.sendT);
  let prevArrival = 0;
  const out = [];
  const effectiveBandwidth = link.bandwidth * (link.ratio ?? 1);
  for (const s of sorted) {
    const arrivalT = Math.max(prevArrival, s.sendT + link.latency) + s.bytes / effectiveBandwidth;
    out.push({ ...s, arrivalT });
    prevArrival = arrivalT;
  }
  return out;
};

// split a frame into ~chunkSize chunks sent chunkGapMs apart
export const frameSends = (frameId, totalBytes, sendT, chunkSize, chunkGap) => {
  const sends = [];
  let remaining = totalBytes;
  let i = 0;
  while (remaining > 0) {
    const bytes = Math.min(chunkSize, remaining);
    remaining -= bytes;
    sends.push({
      frameId,
      frameBytes: totalBytes,
      bytes,
      isLast: remaining <= 0,
      sendT: sendT + i * chunkGap,
    });
    i += 1;
  }
  return sends;
};

// --- scenarios -------------------------------------------------------------
export const LAN = { latency: 0.5, bandwidth: 1_000_000, ratio: 4 }; // 1 GB/s
export const SLOW = { latency: 30, bandwidth: 1_000, ratio: 4 }; // 1 MB/s uplink, 30ms RTT, ~4x permessage-deflate

const fmt = (n) => (n == null ? "  - " : n.toFixed(1).padStart(7));

const summarizeFrame = (frames, metrics, frameId) => {
  const f = frames.get(frameId);
  const rs = metrics.renders.filter((r) => r.frameId === frameId);
  const partials = rs.filter((r) => !r.complete).length;
  const total = rs.length;
  const complete = rs.find((r) => r.complete);
  const ttc = complete && f ? complete.t - f.firstSendT : null;
  return { total, partials, ttc, f };
};

const runScenario = (label, sends, link, mode, watchFrameId, echoKeystrokeT) => {
  const arrivals = planArrivals(sends, link);
  const { frames, metrics, sim } = runPipeline(mode, arrivals, {});
  const out = { label, mode };
  out.rafEvents = sim.rafEvents;
  out.busyMs = sim.busyUntil;
  if (watchFrameId !== undefined) {
    const s = summarizeFrame(frames, metrics, watchFrameId);
    out.renders = s.total;
    out.partials = s.partials;
    out.ttcMs = s.ttc;
    out.progressive = s.total; // renders before + including the complete one
  }
  out.renderFps = null;
  out.echoLatencyMs = null;
  return { out, frames, metrics, sim };
};

// Face 1: one 100KB redraw split into 32KB chunks. LAN vs SLOW.
const face1 = (link, mode, totalBytes = 100 * 1024) => {
  const id = 1;
  const sends = frameSends(id, totalBytes, 0, SERVER_BATCH_FLUSH_BYTES, 2);
  const label = `Face1 ${link === LAN ? "LAN" : "SLOW/5G"} ${Math.round(totalBytes / 1024)}KB`;
  const { out } = runScenario(label, sends, link, mode, id);
  return out;
};

// Face 2: one big write (1.5MB, parse > budget, yields), local delivery (no link spread).
const face2 = (mode) => {
  const id = 2;
  // single chunk delivered instantly (all bytes arrive together) — isolates
  // the parse-yield partial renders from any network split.
  const sends = [
    { frameId: id, frameBytes: 2 * 1024 * 1024, bytes: 2 * 1024 * 1024, isLast: true, sendT: 0 },
  ];
  const link = { latency: 0, bandwidth: 1e9 };
  const { out } = runScenario("Face2 local", sends, link, mode, id);
  return out;
};

// Throughput + keyboard: a high-throughput stream of 32KB chunks every 2ms
// (~16 MB/s) over LAN so the main thread stays saturated parsing; a keystroke
// at pressT is echoed (1 byte, own frame, isLast) and delivered at pressT+RTT
// (NOT serialized behind the stream — a keystroke echo is interactive and
// multiplexes onto the link, it doesn't wait for the firehose to drain). We
// measure how long the echo then waits for the client main thread (the real
// keyboard-responsiveness concern) and the render FPS / partial count.
const stream = (link, mode) => {
  const sends = [];
  const duration = 300;
  const gap = 2; // 64 KB / 2ms = 32 MB/s, under the 50 MB/s parse rate
  const chunkBytes = SERVER_BATCH_FLUSH_BYTES;
  let fid = 100;
  for (let t = 0; t <= duration; t += gap) {
    sends.push({
      frameId: fid++,
      frameBytes: chunkBytes,
      bytes: chunkBytes,
      isLast: false,
      stream: true,
      sendT: t,
    });
  }
  const pressT = 150;
  const echoId = 999;
  const echoArrivalT = pressT + link.latency;
  const echoSend = {
    frameId: echoId,
    frameBytes: 1,
    bytes: 1,
    isLast: true,
    sendT: echoArrivalT,
    echo: true,
  };
  // plan stream arrivals through the serial link, then splice the echo in at
  // its own arrival time (interactive, not link-queued).
  const streamArrivals = planArrivals(sends, link);
  const arrivals = [...streamArrivals, { ...echoSend, arrivalT: echoArrivalT }].sort(
    (a, b) => a.arrivalT - b.arrivalT,
  );
  const { frames, metrics, sim } = runPipeline(mode, arrivals, {});
  const out = { label: `Stream ${link === LAN ? "LAN" : "SLOW"}`, mode };
  out.rafEvents = sim.rafEvents;
  const echoRender =
    metrics.echoCommittedT != null
      ? metrics.renders.find((r) => r.t >= metrics.echoCommittedT - 1e-9)
      : null;
  out.echoLatencyMs = echoRender ? echoRender.t - pressT : null;
  const streamRenders = metrics.renders.filter((r) => r.frameId !== echoId);
  const span = streamRenders.length
    ? streamRenders[streamRenders.length - 1].t - streamRenders[0].t
    : 0;
  out.renderFps = span > 0 ? streamRenders.length / (span / 1000) : 0;
  out.streamRenders = streamRenders.length;
  out.streamPartials = streamRenders.filter((r) => !r.complete).length;
  out.parseBusyMs = sim.busyUntil;
  out.completions = metrics.completions;
  out.flushes = metrics.flushes;
  return out;
};

const fmtCell = (c) => (typeof c === "number" ? c.toFixed(1) : (c ?? ""));
const printRow = (cols) =>
  console.log(cols.map((c) => String(fmtCell(c)).padStart(13)).join(" | "));
const printTable = (title, rows, headers) => {
  console.log(`\n=== ${title} ===`);
  printRow(headers);
  console.log("-".repeat(headers.length * 15));
  for (const r of rows) printRow(headers.map((h) => r[h] ?? ""));
};

const main = () => {
  // Each scenario runs the shipped raw in/out, the pre-raw-in-out idle-debounce
  // backstop, and the deferred frame-marker (frameskip) ideal. Face 1 is run
  // for a big frame (> the 64KB cap, so the server splits it) and a small frame
  // (<= the cap, so the server sends one atomic message), over LAN and 5G.
  const scenarios = [
    [
      "Face 1 (LAN, 100KB > 64KB cap -> 2 split messages)",
      () => face1(LAN, "raw", 100 * 1024),
      () => face1(LAN, "debounce", 100 * 1024),
      () => face1(LAN, "frameskip", 100 * 1024),
    ],
    [
      "Face 1 (SLOW/5G, 100KB > 64KB cap -> 2 split messages)",
      () => face1(SLOW, "raw", 100 * 1024),
      () => face1(SLOW, "debounce", 100 * 1024),
      () => face1(SLOW, "frameskip", 100 * 1024),
    ],
    [
      "Face 1 (SLOW/5G, 40KB <= 64KB cap -> 1 atomic message)",
      () => face1(SLOW, "raw", 40 * 1024),
      () => face1(SLOW, "debounce", 40 * 1024),
      () => face1(SLOW, "frameskip", 40 * 1024),
    ],
    [
      "Face 2 (local 2MB write -> parse yields)",
      () => face2("raw"),
      () => face2("debounce"),
      () => face2("frameskip"),
    ],
    [
      "Stream + keyboard (LAN, saturated)",
      () => stream(LAN, "raw"),
      () => stream(LAN, "debounce"),
      () => stream(LAN, "frameskip"),
    ],
  ];

  for (const [label, rawFn, debFn, skipFn] of scenarios) {
    const raw = { ...rawFn(), mode: "raw" };
    const deb = { ...debFn(), mode: "debounce" };
    const skip = { ...skipFn(), mode: "frameskip" };
    console.log(`\n### ${label}`);
    printTable(
      label,
      [raw, deb, skip],
      [
        "mode",
        "renders",
        "partials",
        "ttcMs",
        "progressive",
        "renderFps",
        "echoLatencyMs",
        "streamPartials",
        "parseBusyMs",
        "rafEvents",
      ],
    );
  }
};

if (import.meta.url === `file://${process.argv[1]}`) main();
