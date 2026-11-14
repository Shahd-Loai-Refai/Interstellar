"""Small web server for the Mission Engineer agent (standard library only).

Run:  python server.py        then open http://localhost:8000

Endpoints (the 3D / 360 website can call these too; CORS is open):
  GET  /api/problems   -> the four open problems
  POST /api/evaluate   -> body {"problem_id": "...", "text": "...", "language": "ar" | "en"}
  GET  /api/report     -> Markdown report of every idea the agent chose to send
  GET  /demo.html      -> test page: stand-in scene + engineer challenge + Mission Reel
"""

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from agent import build_nasa_report, evaluate, load_problems
from agent.agent import settings

STATIC = Path(__file__).resolve().parent / "static"
PORT = int(os.getenv("PORT", "8000"))


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, body, content_type: str = "application/json; charset=utf-8"):
        data = body if isinstance(body, bytes) else (
            body.encode("utf-8") if isinstance(body, str) else json.dumps(body, ensure_ascii=False).encode("utf-8")
        )
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self._send(204, b"")

    def do_GET(self):
        path = urlsplit(self.path).path  # ignore ?problem=... in the URL
        if path in ("/", "/index.html"):
            self._send(200, (STATIC / "index.html").read_bytes(), "text/html; charset=utf-8")
        elif path == "/api/problems":
            problems = [{"id": p["id"], "title": p["title"], "problem": p["problem"],
                         "title_ar": p["title_ar"], "problem_ar": p["problem_ar"],
                         "fact": p.get("fact", ""), "fact_ar": p.get("fact_ar", "")}
                        for p in load_problems()["problems"]]
            self._send(200, {"problems": problems, "mode": settings()["provider"]})
        elif path == "/api/report":
            self._send(200, build_nasa_report(), "text/markdown; charset=utf-8")
        else:
            self._send_static(path)

    def _send_static(self, path: str):
        """Serve other files in static/ (demo.html, reel.js, 3D models...)."""
        types = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
                 ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
                 ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml",
                 ".glb": "model/gltf-binary", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg",
                 ".wasm": "application/wasm"}
        file = (STATIC / path.lstrip("/")).resolve()
        if file.is_dir():
            file = file / "index.html"   # /insight/ opens the 3D scene
        if STATIC in file.parents and file.is_file() and file.suffix.lower() in types:
            self._send(200, file.read_bytes(), types[file.suffix.lower()])
        else:
            self._send(404, {"error": "Not found"})

    def do_POST(self):
        if urlsplit(self.path).path != "/api/evaluate":
            self._send(404, {"error": "Not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length) or b"{}")
            result = evaluate(body.get("problem_id", ""), body.get("text", ""), body.get("language", "ar"))
            self._send(200, result)
        except ValueError as e:
            self._send(400, {"error": str(e)})
        except Exception as e:  # keep the demo running and show a readable error
            self._send(500, {"error": str(e)})

    def log_message(self, fmt, *args):
        print("[server]", fmt % args)


if __name__ == "__main__":
    cfg = settings()
    print(f"Mission Engineer running on http://localhost:{PORT}  (provider: {cfg['provider']}, model: {cfg['model'] or '-'})")
    if cfg["provider"] == "mock":
        print("No API key found -> MOCK mode (placeholder scores). Add your key to .env for real evaluation.")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
