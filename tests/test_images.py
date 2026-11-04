"""The demo data must be real, consistent and licensed: images.json, the files, and CREDITS.md agree."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATIC = ROOT / "static"
sys.path.insert(0, str(ROOT / "tools"))
from fetch_images import jpeg_size  # noqa: E402

IMAGES = json.loads((STATIC / "images.json").read_text(encoding="utf-8"))
CREDITS = (ROOT / "CREDITS.md").read_text(encoding="utf-8")


def test_there_are_enough_images_for_the_demo():
    assert len(IMAGES) >= 16


def test_every_entry_has_the_fields_the_module_needs():
    for e in IMAGES:
        assert {"src", "alt", "width", "height"} <= set(e), e
        assert e["alt"].strip(), e["src"]


def test_every_file_exists_and_declared_dimensions_match_the_jpeg():
    for e in IMAGES:
        data = (STATIC / e["src"]).read_bytes()
        assert jpeg_size(data) == (e["width"], e["height"]), e["src"]


def test_no_remote_urls():
    for e in IMAGES:
        assert not e["src"].startswith(("http:", "https:", "//")), e["src"]


def test_every_image_is_credited_with_an_allowed_licence():
    rows = {l.split("|")[1].strip().strip("`"): l for l in CREDITS.splitlines() if l.startswith("| `static/images/")}
    for e in IMAGES:
        row = rows.get("static/" + e["src"])
        assert row, "%s is not in CREDITS.md" % e["src"]
        licence = row.split("|")[4].strip()
        assert licence in ("Public domain", "CC0"), (e["src"], licence)


def test_no_unreferenced_images_are_shipped():
    on_disk = {"images/" + p.name for p in (STATIC / "images").iterdir()}
    assert on_disk == {e["src"] for e in IMAGES}


def test_no_font_or_other_unlicensed_binary_in_static():
    assert not list(STATIC.rglob("*.ttf")) and not list(STATIC.rglob("*.otf")) and not list(STATIC.rglob("*.woff*"))
