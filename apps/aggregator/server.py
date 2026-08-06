#!/usr/bin/env python3
"""Aggregator: shared state + localterm session management (native multi-client sharing)."""
import http.server, socketserver, subprocess, json, re, os, shutil, urllib.parse, threading

DIR = os.path.dirname(os.path.abspath(__file__))
LT = shutil.which("localterm") or os.path.expanduser("~/.npm-global/bin/localterm")
STATE_FILE = os.path.join(DIR, "state.json")
_lock = threading.Lock()

def read_state():
    try:
        with open(STATE_FILE) as f: return json.load(f)
    except Exception:
        return {"workspaces": [], "activeWs": None, "nextId": 1, "version": 0}

def write_state(s):
    with _lock:
        try: old = read_state()
        except Exception: old = {}
        s = dict(s); s["version"] = old.get("version", 0) + 1
        with open(STATE_FILE, "w") as f: json.dump(s, f)
        return s

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=DIR, **kw)
    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code); self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body))); self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        u = urllib.parse.urlparse(self.path); q = urllib.parse.parse_qs(u.query)
        if u.path == "/api/state": return self._json(200, read_state())
        if u.path == "/api/new-session":
            cwd = q.get("cwd",[None])[0]; name = q.get("name",[None])[0]
            if cwd and not os.path.isdir(cwd): return self._json(400, {"error":"not a directory","cwd":cwd})
            args = [LT, "session", "new", "--json"]
            if cwd: args += ["--cwd", cwd]
            if name: args += ["--name", name[:60]]
            try:
                out = subprocess.check_output(args, stderr=subprocess.STDOUT, text=True, timeout=15)
                d = json.loads(out)
                return self._json(200, {"sid": d["id"]})
            except Exception as e: return self._json(500, {"error": str(e)})
        if u.path == "/api/kill-session":
            sid = q.get("sid",[None])[0]
            if sid and re.fullmatch(r"[a-f0-9-]+", sid):
                subprocess.run([LT, "session", "kill", sid], timeout=10, capture_output=True)
                return self._json(200, {"ok": True})
            return self._json(400, {"error":"bad sid"})
        return super().do_GET()
    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        if u.path == "/api/state":
            length = int(self.headers.get('content-length', 0))
            body = self.rfile.read(length) if length else b'{}'
            try: return self._json(200, write_state(json.loads(body)))
            except Exception as e: return self._json(400, {"error": str(e)})
        return self._json(404, {"error":"not found"})
    def log_message(self, *a): pass

class S(socketserver.ThreadingTCPServer):
    allow_reuse_address = True; daemon_threads = True
with S(("127.0.0.1", 8090), H) as httpd:
    print("aggregator on http://127.0.0.1:8090")
    httpd.serve_forever()
