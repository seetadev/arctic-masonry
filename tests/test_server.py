"""Server tests: static serving, compression, path traversal, port handling."""
import gzip
import json
import subprocess
import sys
from pathlib import Path

from tornado.testing import AsyncHTTPTestCase

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import run  # noqa: E402


class ServerTest(AsyncHTTPTestCase):
    def get_app(self):
        return run.make_app()

    def test_root_serves_index(self):
        r = self.fetch("/")
        assert r.code == 200
        assert b"<title>Arctic Masonry</title>" in r.body

    def test_module_and_css_content_types(self):
        js = self.fetch("/arctic-masonry.js")
        assert js.code == 200 and "javascript" in js.headers["Content-Type"]
        css = self.fetch("/arctic-masonry.css")
        assert css.code == 200 and css.headers["Content-Type"].startswith("text/css")

    def test_json_is_gzipped_when_asked(self):
        r = self.fetch("/images.json", headers={"Accept-Encoding": "gzip"}, decompress_response=False)
        assert r.code == 200
        assert r.headers.get("Content-Encoding") == "gzip"
        assert json.loads(gzip.decompress(r.body))

    def test_traversal_never_leaks_files_outside_static(self):
        for path in ("/../run.py", "/%2e%2e/run.py", "/..%2frun.py", "/images/../../run.py",
                     "/%2e%2e%2frequirements.txt", "/../.git/config"):
            r = self.fetch(path)
            assert r.code in (403, 404), path
            assert b"tornado" not in r.body.lower(), path

    def test_non_static_files_are_not_served(self):
        for name in ("/run.py", "/requirements.txt", "/tools/fetch_images.py", "/CREDITS.md"):
            assert self.fetch(name).code == 404, name

    def test_missing_file_is_404(self):
        assert self.fetch("/nope.png").code == 404


def test_bad_port_exits_with_a_clear_message():
    p = subprocess.run([sys.executable, str(ROOT / "run.py"), "abc"], capture_output=True, text=True, timeout=30)
    assert p.returncode != 0
    assert "port must be a number" in p.stderr
