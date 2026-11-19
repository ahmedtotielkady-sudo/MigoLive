#!/usr/bin/env python3
"""Keep the embedded in-app Slot 777 copy identical to the server-backed page."""
from pathlib import Path
import base64
import re

app_path = Path("index.html")
game_path = Path("slot-777.html")
app = app_path.read_text(encoding="utf-8")
game = game_path.read_text(encoding="utf-8")
bundle = re.search(r"(const GB=\{)([\s\S]*?)(\};\s*const GM=)", app)
if not bundle:
    raise SystemExit("Could not find embedded game bundle in index.html")
encoded = re.search(r'((?:^|,)slot777:)"([A-Za-z0-9+/=]+)"', bundle.group(2))
if not encoded:
    raise SystemExit("Could not find embedded Slot 777 page in index.html")
packed = base64.b64encode(game.encode("utf-8")).decode("ascii")
new_body = bundle.group(2)[:encoded.start(2)] + packed + bundle.group(2)[encoded.end(2):]
app = app[:bundle.start(2)] + new_body + app[bundle.end(2):]
app_path.write_text(app, encoding="utf-8")
print("Synchronized embedded Slot 777 with server-backed game page")
