/**
 * MV3 CDP relay. The daemon speaks the same JSON-RPC as Chrome's browser
 * WebSocket; this worker emulates browser-level Target.* with chrome.tabs /
 * chrome.debugger and pass-throughs every other domain via sendCommand.
 *
 * Connects to ws://127.0.0.1:<port>/extension (default 3417, same as
 * localterm DEFAULT_PORT). Last-writer-wins on the daemon side.
 */

const DEFAULT_PORT = 3417;
const PROTOCOL = "1.3";
const RECONNECT_MIN_MS = 400;
const RECONNECT_MAX_MS = 5_000;

/** @type {WebSocket | null} */
let ws = null;
let reconnectMs = RECONNECT_MIN_MS;
let reconnectTimer = null;
let autoAttach = false;
let discoverTargets = false;

/** sessionId -> { tabId, targetId } */
const sessions = new Map();
/** tabId -> sessionId */
const tabToSession = new Map();

chrome.runtime.onInstalled.addListener(() => connect());
chrome.runtime.onStartup.addListener(() => connect());
chrome.action.onClicked.addListener(() => {
  disconnect();
  reconnectMs = RECONNECT_MIN_MS;
  connect();
});
chrome.alarms.create("bh-keepalive", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name !== "bh-keepalive") return;
  if (!ws || ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED) connect();
});

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (source.tabId == null) return;
  const sessionId = tabToSession.get(source.tabId);
  emit({ method, params, sessionId });
});

chrome.debugger.onDetach.addListener((source, reason) => {
  if (source.tabId == null) return;
  const sessionId = tabToSession.get(source.tabId);
  forgetTab(source.tabId);
  if (sessionId) {
    emit({
      method: "Inspector.detached",
      params: { reason: reason || "target_closed" },
      sessionId,
    });
    emit({
      method: "Target.detachedFromTarget",
      params: { sessionId, targetId: String(source.tabId) },
    });
  }
});

chrome.tabs.onCreated.addListener(async (tab) => {
  if (tab.id == null) return;
  const info = targetInfoFromTab(tab);
  if (discoverTargets) emit({ method: "Target.targetCreated", params: { targetInfo: info } });
  if (!autoAttach) return;
  try {
    const sessionId = await attachTab(tab.id, String(tab.id));
    emit({
      method: "Target.attachedToTarget",
      params: { sessionId, waitingForDebugger: false, targetInfo: info },
    });
  } catch {
    /* chrome:// and other restricted pages */
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const sessionId = tabToSession.get(tabId);
  if (discoverTargets)
    emit({ method: "Target.targetDestroyed", params: { targetId: String(tabId) } });
  if (sessionId)
    emit({ method: "Target.detachedFromTarget", params: { sessionId, targetId: String(tabId) } });
  forgetTab(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, _change, tab) => {
  if (!discoverTargets) return;
  emit({ method: "Target.targetInfoChanged", params: { targetInfo: targetInfoFromTab(tab) } });
});

connect();

function port() {
  return DEFAULT_PORT;
}

function wsUrl() {
  return "ws://127.0.0.1:" + port() + "/extension";
}

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  disconnect();
  let sock;
  try {
    sock = new WebSocket(wsUrl());
  } catch {
    scheduleReconnect();
    return;
  }
  ws = sock;
  sock.addEventListener("open", () => {
    reconnectMs = RECONNECT_MIN_MS;
    setBadge(true);
  });
  sock.addEventListener("message", (ev) => {
    void onDaemonMessage(String(ev.data));
  });
  sock.addEventListener("close", () => {
    if (ws === sock) ws = null;
    setBadge(false);
    scheduleReconnect();
  });
  sock.addEventListener("error", () => {
    try {
      sock.close();
    } catch {
      /* ignore */
    }
  });
}

function disconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  const sock = ws;
  ws = null;
  if (sock) {
    try {
      sock.close();
    } catch {
      /* ignore */
    }
  }
  setBadge(false);
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  const wait = reconnectMs;
  reconnectMs = Math.min(reconnectMs * 2, RECONNECT_MAX_MS);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, wait);
}

function setBadge(connected) {
  try {
    chrome.action.setBadgeText({ text: connected ? "on" : "" });
    chrome.action.setBadgeBackgroundColor({ color: connected ? "#0a0" : "#666" });
  } catch {
    /* ignore */
  }
}

function emit(msg) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    /* ignore */
  }
}

async function onDaemonMessage(raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  if (typeof msg.id !== "number" || typeof msg.method !== "string") return;
  try {
    const result = await dispatch(msg.method, msg.params ?? {}, msg.sessionId);
    emit({ id: msg.id, result: result ?? {} });
  } catch (e) {
    const message = e && e.message ? e.message : String(e);
    const code = /session with given id not found/i.test(message) ? -32001 : -32000;
    emit({ id: msg.id, error: { code, message } });
  }
}

async function dispatch(method, params, sessionId) {
  switch (method) {
    case "Target.getTargets":
      return getTargets();
    case "Target.createTarget":
      return createTarget(params);
    case "Target.attachToTarget":
      return attachToTarget(params);
    case "Target.closeTarget":
      return closeTarget(params);
    case "Target.activateTarget":
      return activateTarget(params);
    case "Target.detachFromTarget":
      return detachFromTarget(params);
    case "Target.getTargetInfo":
      return getTargetInfo(params);
    case "Target.setDiscoverTargets":
      discoverTargets = Boolean(params.discover);
      return {};
    case "Target.setAutoAttach":
      autoAttach = Boolean(params.autoAttach);
      return {};
    case "Browser.getVersion":
      return {
        protocolVersion: PROTOCOL,
        product: "Chrome/extension",
        revision: "",
        userAgent: navigator.userAgent,
        jsVersion: "",
      };
    default:
      break;
  }
  if (method.startsWith("Target.") || method.startsWith("Browser.")) {
    throw new Error(method + " is not available over the extension transport");
  }
  if (!sessionId) throw new Error("No sessionId for " + method);
  const sess = sessions.get(sessionId);
  if (!sess) throw new Error("Session with given id not found");
  return await sendCommand(sess.tabId, method, params);
}

async function sendCommand(tabId, method, params) {
  const result = await chrome.debugger.sendCommand({ tabId }, method, params ?? {});
  return result ?? {};
}

async function getTargets() {
  const tabs = await chrome.tabs.query({});
  return { targetInfos: tabs.filter((t) => t.id != null).map(targetInfoFromTab) };
}

function targetInfoFromTab(tab) {
  const tabId = tab.id;
  return {
    targetId: String(tabId),
    type: "page",
    title: tab.title || "",
    url: tab.url || "",
    attached: tabToSession.has(tabId),
    canAccessOpener: false,
  };
}

async function createTarget(params) {
  const url = typeof params.url === "string" && params.url ? params.url : "about:blank";
  const background = Boolean(params.background);
  if (params.newWindow) {
    const win = await chrome.windows.create({ url, focused: !background });
    const tab = win.tabs && win.tabs[0];
    if (!tab || tab.id == null) throw new Error("Target.createTarget: window opened with no tab");
    return { targetId: String(tab.id) };
  }
  const tab = await chrome.tabs.create({ url, active: !background });
  if (tab.id == null) throw new Error("Target.createTarget: tab has no id");
  return { targetId: String(tab.id) };
}

async function attachToTarget(params) {
  const targetId = String(params.targetId ?? "");
  if (!targetId) throw new Error("Target.attachToTarget requires targetId");
  const tabId = Number(targetId);
  if (!Number.isFinite(tabId))
    throw new Error("Target.attachToTarget: unknown targetId " + targetId);
  const sessionId = await attachTab(tabId, targetId);
  return { sessionId };
}

async function attachTab(tabId, targetId) {
  const existing = tabToSession.get(tabId);
  if (existing) return existing;
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    throw new Error("No target with given id found");
  }
  const url = tab.url || "";
  if (
    url.startsWith("chrome://") ||
    url.startsWith("devtools://") ||
    url.startsWith("chrome-extension://")
  ) {
    throw new Error("Cannot attach to " + url + " over the extension transport");
  }
  await chrome.debugger.attach({ tabId }, PROTOCOL);
  const sessionId = crypto.randomUUID();
  sessions.set(sessionId, { tabId, targetId: targetId || String(tabId) });
  tabToSession.set(tabId, sessionId);
  return sessionId;
}

async function closeTarget(params) {
  const tabId = Number(params.targetId);
  if (!Number.isFinite(tabId)) throw new Error("Target.closeTarget requires targetId");
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    /* not attached */
  }
  forgetTab(tabId);
  try {
    await chrome.tabs.remove(tabId);
  } catch {
    /* already gone */
  }
  return { success: true };
}

async function activateTarget(params) {
  const tabId = Number(params.targetId);
  if (!Number.isFinite(tabId)) throw new Error("Target.activateTarget requires targetId");
  const tab = await chrome.tabs.update(tabId, { active: true });
  if (tab.windowId != null) {
    try {
      await chrome.windows.update(tab.windowId, { focused: true });
    } catch {
      /* ignore */
    }
  }
  return {};
}

async function detachFromTarget(params) {
  let tabId;
  if (params.sessionId) {
    const sess = sessions.get(params.sessionId);
    if (!sess) return {};
    tabId = sess.tabId;
  } else if (params.targetId != null) {
    tabId = Number(params.targetId);
  }
  if (tabId == null || !Number.isFinite(tabId)) return {};
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    /* ignore */
  }
  forgetTab(tabId);
  return {};
}

async function getTargetInfo(params) {
  const tabId = Number(params.targetId);
  if (!Number.isFinite(tabId)) throw new Error("Target.getTargetInfo requires targetId");
  const tab = await chrome.tabs.get(tabId);
  return { targetInfo: targetInfoFromTab(tab) };
}

function forgetTab(tabId) {
  const sessionId = tabToSession.get(tabId);
  tabToSession.delete(tabId);
  if (sessionId) sessions.delete(sessionId);
}
