"""Security behaviour of the server: headers, HSTS opt-in, error bodies, hidden files, symlinks, traversal."""
import os
import subprocess
import sys
from pathlib import Path

from tornado.testing import AsyncHTTPTestCase

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import run  # noqa: E402

REQUIRED = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
}


class HeadersTest(AsyncHTTPTestCase):
    def get_app(self):
        return run.make_app()

    def test_security_headers_on_success_and_on_errors(self):
        for path in ("/", "/arctic-masonry.js", "/images.json", "/nope", "/../run.py"):
            r = self.fetch(path)
            for name, value in REQUIRED.items():
                assert r.headers.get(name) == value, (path, name)
            assert "Content-Security-Policy" in r.headers, path

    def test_csp_is_strict(self):
        csp = self.fetch("/").headers["Content-Security-Policy"]
        for directive in ("default-src 'none'", "script-src 'self'", "style-src 'self'", "base-uri 'none'",
                          "form-action 'none'", "frame-ancestors 'none'"):
            assert directive in csp
        for weak in ("unsafe-inline", "unsafe-eval", "*", "http:"):
            assert weak not in csp.replace("img-src 'self' data:", ""), weak

    def test_hsts_is_off_by_default(self):
        assert "Strict-Transport-Security" not in self.fetch("/").headers

    def test_no_server_banner(self):
        assert "Server" not in self.fetch("/").headers
        assert "tornado" not in str(self.fetch("/nope").headers).lower()

    def test_error_bodies_are_constant_plain_text(self):
        r = self.fetch("/nope.png")
        assert r.code == 404
        assert r.headers["Content-Type"].startswith("text/plain")
        assert r.body.decode().strip() == "404 Not Found"
        assert b"nope.png" not in r.body and b"<" not in r.body

    def test_hidden_files_are_refused(self):
        for path in ("/.env", "/.git/config", "/images/.hidden", "/%2eenv"):
            assert self.fetch(path).code in (403, 404), path

    def test_only_get_and_head(self):
        for method in ("POST", "PUT", "DELETE", "PATCH"):
            assert self.fetch("/", method=method, body="x" if method != "DELETE" else None, allow_nonstandard_methods=True).code == 405, method
        assert self.fetch("/", method="HEAD").code == 200


class HstsTest(AsyncHTTPTestCase):
    def get_app(self):
        return run.make_app(hsts=run.hsts_value(31536000))

    def test_hsts_max_age_only_by_default_when_enabled(self):
        h = self.fetch("/").headers["Strict-Transport-Security"]
        assert h == "max-age=31536000"
        assert "includeSubDomains" not in h and "preload" not in h


def test_hsts_value_variants():
    assert run.hsts_value(0) is None
    assert run.hsts_value(None) is None
    assert run.hsts_value(60) == "max-age=60"
    assert run.hsts_value(60, True) == "max-age=60; includeSubDomains"
    assert "preload" not in run.hsts_value(60, True)


def test_hsts_env_parsing():
    assert run.hsts_from_env({}) is None
    assert run.hsts_from_env({"HSTS_SECONDS": "0"}) is None
    assert run.hsts_from_env({"HSTS_SECONDS": "300"}) == "max-age=300"
    # includeSubDomains alone does nothing; it is a separate opt-in on top of a max-age
    assert run.hsts_from_env({"HSTS_INCLUDE_SUBDOMAINS": "1"}) is None
    assert run.hsts_from_env({"HSTS_SECONDS": "300", "HSTS_INCLUDE_SUBDOMAINS": "1"}) == "max-age=300; includeSubDomains"


def test_bad_hsts_value_exits_with_a_clear_message():
    env = dict(os.environ, HSTS_SECONDS="soon")
    p = subprocess.run([sys.executable, str(ROOT / "run.py"), "8899"], capture_output=True, text=True, timeout=30, env=env)
    assert p.returncode != 0 and "HSTS_SECONDS must be" in p.stderr


class SymlinkTest(AsyncHTTPTestCase):
    """A symlink inside static/ that points outside it must not be followed."""

    def get_app(self):
        import tempfile
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        (base / "static").mkdir()
        (base / "static" / "index.html").write_text("<p>ok</p>")
        (base / "secret.txt").write_text("top secret")
        (base / "static" / "leak.txt").symlink_to(base / "secret.txt")
        (base / "static" / ".env").write_text("SECRET=1")
        return run.make_app(static_dir=base / "static")

    def tearDown(self):
        super().tearDown()
        self.tmp.cleanup()

    def test_symlink_out_of_root_is_refused(self):
        r = self.fetch("/leak.txt")
        assert r.code == 403 and b"top secret" not in r.body

    def test_dotfile_inside_root_is_refused(self):
        r = self.fetch("/.env")
        assert r.code == 403 and b"SECRET" not in r.body
