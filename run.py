"""Small Tornado server for the Arctic Masonry demo: python run.py [port]   (or set PORT; default 8888).

Optional environment variables (for production behind a TLS-terminating proxy only):
  HSTS_SECONDS               send Strict-Transport-Security with this max-age. Off (unset/0) by default.
  HSTS_INCLUDE_SUBDOMAINS=1  also send includeSubDomains. Off by default; a long max-age cannot be undone
                             remotely, so enable it only when every subdomain is HTTPS. `preload` is never sent.
"""
import asyncio
import os
import sys
from pathlib import Path

import tornado.web

STATIC_DIR = Path(__file__).resolve().parent / "static"

# The demo page and module use no inline script or style, no fonts, no third-party origins.
CSP = ("default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; "
       "base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
SECURITY_HEADERS = {
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
}


def hsts_value(seconds, include_subdomains=False):
    if not seconds:
        return None
    return "max-age=%d%s" % (seconds, "; includeSubDomains" if include_subdomains else "")


class StaticHandler(tornado.web.StaticFileHandler):
    """Serves static/ only: security headers on every response, no server banner, no dotfiles."""

    def set_default_headers(self):
        self.clear_header("Server")
        for name, value in SECURITY_HEADERS.items():
            self.set_header(name, value)
        # Read from the application settings: Tornado calls this before initialize(), and again on errors.
        hsts = self.application.settings.get("hsts")
        if hsts:
            self.set_header("Strict-Transport-Security", hsts)

    @classmethod
    def get_absolute_path(cls, root, path):
        # Refuse hidden files/directories (".env", ".git/...") anywhere in the requested path.
        if any(part.startswith(".") and part not in ("", ".") for part in path.split("/")):
            raise tornado.web.HTTPError(403, "hidden files are not served")
        return super().get_absolute_path(root, path)

    def write_error(self, status_code, **kwargs):
        # Plain, constant error bodies: nothing about the filesystem or the framework version.
        self.set_header("Content-Type", "text/plain; charset=utf-8")
        self.finish("%d %s\n" % (status_code, self._reason))


def make_app(static_dir=STATIC_DIR, hsts=None):
    return tornado.web.Application(
        [(r"/(.*)", StaticHandler, {"path": str(static_dir), "default_filename": "index.html"})],
        compress_response=True,
        hsts=hsts,
        debug=False,
    )


def hsts_from_env(env=os.environ):
    raw = env.get("HSTS_SECONDS", "").strip()
    if raw in ("", "0"):
        return None
    try:
        seconds = int(raw)
        if seconds < 0:
            raise ValueError
    except ValueError:
        sys.exit("Error: HSTS_SECONDS must be a non-negative number of seconds, got %r" % raw)
    return hsts_value(seconds, env.get("HSTS_INCLUDE_SUBDOMAINS", "") == "1")


async def serve(port, hsts):
    make_app(hsts=hsts).listen(port)
    print("Arctic Masonry running at http://localhost:%d" % port)
    await asyncio.Event().wait()


def main():
    raw = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("PORT", "8888")
    try:
        port = int(raw)
    except ValueError:
        sys.exit("Error: port must be a number, got %r" % raw)
    asyncio.run(serve(port, hsts_from_env()))


if __name__ == "__main__":
    main()
