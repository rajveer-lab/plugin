"""Developer preview server: serves the repo root with caching off, so edits show on reload.

    python tools/ui-preview/serve.py        then open http://localhost:8765/tools/ui-preview/
"""
import functools
import http.server
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    handler = functools.partial(NoCacheHandler, directory=ROOT)
    http.server.ThreadingHTTPServer(("127.0.0.1", 8765), handler).serve_forever()
