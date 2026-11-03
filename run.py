"""Small Tornado server for the Arctic Masonry demo: python run.py [port]   (or set PORT; default 8888)."""
import asyncio
import os
import sys
from pathlib import Path

import tornado.web

STATIC_DIR = Path(__file__).resolve().parent / "static"


def make_app():
    return tornado.web.Application(
        [(r"/(.*)", tornado.web.StaticFileHandler, {"path": str(STATIC_DIR), "default_filename": "index.html"})],
        compress_response=True,
        debug=False,
    )


async def serve(port):
    make_app().listen(port)
    print("Arctic Masonry running at http://localhost:%d" % port)
    await asyncio.Event().wait()


def main():
    raw = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("PORT", "8888")
    try:
        port = int(raw)
    except ValueError:
        sys.exit("Error: port must be a number, got %r" % raw)
    asyncio.run(serve(port))


if __name__ == "__main__":
    main()
