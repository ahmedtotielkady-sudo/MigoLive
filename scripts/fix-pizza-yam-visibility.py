#!/usr/bin/env python3
"""Keep Pizza Yam visible unless the server explicitly disables it."""
from pathlib import Path

p = Path("www/index.html")
if not p.is_file():
    raise SystemExit("www/index.html is missing")
html = p.read_text(encoding="utf-8")

replacements = [
    (
        "available=new Set((policy.games||[]).filter(x=>x.enabled!==false).map(x=>x.id))",
        "available=new Set((policy.games||[]).filter(x=>x.enabled===false).map(x=>x.id))"
    ),
    (
        "const list=Object.entries(GM).filter(([k])=>!available||available.has(idMap[k]));",
        "const list=Object.entries(GM).filter(([k])=>!available||!available.has(idMap[k]));"
    ),
    (
        "const items=Object.entries(GM).filter(([k])=>!available||available.has(idMap[k]))",
        "const items=Object.entries(GM).filter(([k])=>!available||!available.has(idMap[k]))"
    ),
    (
        "draw(new Set((p.games||[]).filter(x=>x.enabled!==false).map(x=>x.id)))",
        "draw(new Set((p.games||[]).filter(x=>x.enabled===false).map(x=>x.id)))"
    ),
]
for old, new in replacements:
    count = html.count(old)
    if count == 0 and new not in html:
        raise SystemExit("Expected game visibility expression was not found: " + old)
    if count:
        html = html.replace(old, new)

# Keep the game tile descriptive and clearly tied to the shared wallet.
html = html.replace(
    "pizza:{n:'بيتزا يم',i:'🍕',d:'اختيار الطعام · مضاعفات حتى 45×'}",
    "pizza:{n:'بيتزا يم',i:'🍕',d:'رهانات متعددة · دوران 4 ثوانٍ · رصيد المحفظة'}"
)
# Ensure the main Games page and room picker both have the same explicit ID mapping.
if "pizza:'pizza-yam'" not in html:
    raise SystemExit("Pizza Yam is missing from the app game ID mapping")
if "pizza:{n:'بيتزا يم'" not in html:
    raise SystemExit("Pizza Yam is missing from the app game catalog")

p.write_text(html, encoding="utf-8")
print("Pizza Yam visibility now hides the tile only when the server explicitly disables it")
