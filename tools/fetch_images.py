#!/usr/bin/env python3
"""Download the demo images from Wikimedia Commons and (re)generate their metadata.

Standard library only. For each title below it asks the Commons API for the licence and author,
**refuses anything that is not Public domain or CC0**, downloads a 640 px wide thumbnail into
static/images/, and writes static/images.json (src/alt/width/height) and CREDITS.md (title, author,
licence, source page). Re-run to regenerate:   python tools/fetch_images.py
"""
import html
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "static" / "images"
API = "https://commons.wikimedia.org/w/api.php"
UA = {"User-Agent": "arctic-masonry/1.0 (https://github.com/seetadev/arctic-masonry; image fetch script)"}
ALLOWED = {"Public domain", "CC0"}
WIDTH = 500  # a standard Commons thumbnail width (other values are rounded up by the CDN)

TITLES = [  # varied aspect ratios on purpose: this is a masonry demo
    "Apollo 4 liftoff - GPN-2006-000038.jpg",
    "PIA08576-Spirit Rover-Possible Meteorites at Low Ridge.jpg",
    "Apollo 7 Launch (jsc2005e16194).jpg",
    "Voyager 2 Launch - GPN-2003-000002.jpg",
    "Apollo 11 Launch - GPN-2000-000630.jpg",
    "NGC 6302 Hubble 2009.full.jpg",
    "Pillars of creation 2014 HST WFC3-UVIS full-res denoised.jpg",
    "Crab Nebula.jpg",
    "Hubble image of the Ring Nebula (Messier 57).jpg",
    "The Blue Marble (remastered).jpg",
    "Saturn during Equinox.jpg",
    "Keyhole Nebula - Hubble 1999.jpg",
    "Top of Atmosphere.jpg",
    "NASA Space Shuttle Atlantis landing (STS-110) (19 April 2002).jpg",
    "ISS-67 The International Space Station soars above an aurora.jpg",
    "Spirit Rover Sol 572 in sol149Pan.jpg",
]


ALT_OVERRIDE = {  # Commons has no usable description for these
    "Spirit Rover Sol 572 in sol149Pan.jpg": "Panorama of the Martian surface taken by NASA's Spirit rover on sol 572",
}


def jpeg_size(data):
    """(width, height) from the JPEG header (the real downloaded file, not what the API promised)."""
    i = 2
    while i < len(data):
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            return int.from_bytes(data[i + 7:i + 9], "big"), int.from_bytes(data[i + 5:i + 7], "big")
        i += 2 + int.from_bytes(data[i + 2:i + 4], "big")
    raise ValueError("no SOF marker")


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return r.read()


def text(value, limit=None):
    s = html.unescape(re.sub(r"<[^>]+>", " ", value or ""))
    s = re.sub(r"\s+", " ", s).strip()
    return s if limit is None or len(s) <= limit else s[: limit - 1].rstrip() + "…"


def slug(title):
    return re.sub(r"[^a-z0-9]+", "-", Path(title).stem.lower()).strip("-")


def main():
    q = urllib.parse.urlencode({
        "action": "query", "format": "json", "prop": "imageinfo", "iiprop": "url|size|extmetadata|mime",
        "iiurlwidth": WIDTH, "titles": "|".join("File:" + t for t in TITLES)})
    pages = json.loads(get(API + "?" + q))["query"]["pages"].values()
    info = {p["title"][5:]: (p.get("imageinfo") or [None])[0] for p in pages}
    OUT.mkdir(parents=True, exist_ok=True)
    items, credits = [], []
    for t in TITLES:
        ii = info.get(t)
        if not ii:
            sys.exit("not found on Commons: " + t)
        meta = ii["extmetadata"]
        lic = meta.get("LicenseShortName", {}).get("value", "?")
        if lic not in ALLOWED or ii["mime"] != "image/jpeg":
            sys.exit("refusing %r: licence %r / %s" % (t, lic, ii["mime"]))
        name = slug(t) + ".jpg"
        data = get(ii["thumburl"])
        (OUT / name).write_bytes(data)
        w, h = jpeg_size(data)
        time.sleep(0.5)  # be polite to the API/CDN
        alt = ALT_OVERRIDE.get(t) or text(meta.get("ImageDescription", {}).get("value"), 140) or text(t)
        items.append({"src": "images/" + name, "alt": alt, "width": w, "height": h})
        credits.append((t, text(meta.get("Artist", {}).get("value"), 120) or "NASA", lic, ii["descriptionurl"], name))
    (ROOT / "static" / "images.json").write_text(json.dumps(items, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    lines = ["# Image credits", "",
             "All demo images are **public domain / CC0** works from Wikimedia Commons (mostly NASA), downloaded as "
             "%d px wide thumbnails by `tools/fetch_images.py`, which refuses any file whose Commons licence is not "
             "Public domain or CC0. The licence column is what the Commons API reported when the files were fetched." % WIDTH,
             "", "| File | Title on Commons | Author / credit | Licence | Source |", "|---|---|---|---|---|"]
    for t, artist, lic, url, name in credits:
        lines.append("| `static/images/%s` | %s | %s | %s | [Commons page](%s) |" % (name, t.replace("|", "/"), artist.replace("|", "/"), lic, url))
    (ROOT / "CREDITS.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("wrote %d images, static/images.json, CREDITS.md" % len(items))


if __name__ == "__main__":
    main()
