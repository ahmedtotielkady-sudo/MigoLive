#!/usr/bin/env python3
"""Install the authenticated API bridge into the actual Android web assets."""
from pathlib import Path
import shutil

root = Path(".")
source = root / "api-bridge.js"
web = root / "www"
index = web / "index.html"

if not source.is_file() or source.stat().st_size < 1000:
    raise SystemExit("api-bridge.js is missing or incomplete")
if not index.is_file():
    raise SystemExit("www/index.html is missing")

html = index.read_text(encoding="utf-8")
tag = '<script src="api-bridge.js"></script>'
if tag not in html:
    if "</body>" not in html:
        raise SystemExit("www/index.html has no closing body tag")
    html = html.replace("</body>", tag + chr(10) + "</body>", 1)

shutil.copy2(source, web / "api-bridge.js")
index.write_text(html, encoding="utf-8")

# Fail closed: the APK must contain both the loader and the actual bridge file.
if tag not in index.read_text(encoding="utf-8") or not (web / "api-bridge.js").is_file():
    raise SystemExit("Authenticated wallet bridge was not installed in www")
print("Installed authenticated API bridge into www/index.html and www/api-bridge.js")
