from pathlib import Path
import base64

root = Path(".")
html_path = root / "www" / "index.html"
encoded_path = root / "assets" / "migo-purple-background.jpg.b64"
out = root / "www" / "assets" / "migo-purple-background.jpg"

if not html_path.is_file() or not encoded_path.is_file():
    raise SystemExit("Missing MigoLive web assets for background integration")
raw = encoded_path.read_text(encoding="ascii").strip()
try:
    image_bytes = base64.b64decode(raw, validate=True)
except Exception:
    # Recover a single accidental 3-character insertion in the stored base64 text.
    image_bytes = None
    for i in range(max(0, len(raw) - 2)):
        candidate = raw[:i] + raw[i + 3:]
        try:
            decoded = base64.b64decode(candidate, validate=True)
        except Exception:
            continue
        if decoded.startswith(b"\xff\xd8\xff") and decoded.endswith(b"\xff\xd9"):
            image_bytes = decoded
            break
    if image_bytes is None:
        raise SystemExit("Stored background image data is invalid; refusing to build")
out.parent.mkdir(parents=True, exist_ok=True)
out.write_bytes(image_bytes)
if out.stat().st_size < 1000:
    raise SystemExit("Background image decode failed")

html = html_path.read_text(encoding="utf-8")
marker = "document.body.classList.toggle('inroom',!!room);"
replacement = marker + "\n  document.body.classList.toggle('migo-purple-background', ['rooms','games','msgs','me','owner','agency','hostperf'].includes(tab) || !!room);"
if html.count(marker) != 1:
    raise SystemExit(f"Expected one render background hook, found {html.count(marker)}")
html = html.replace(marker, replacement, 1)

css = """
<style id="migo-purple-gold-page-background-v1">
body.migo-purple-background #main{
  background-image:url('assets/migo-purple-background.jpg');
  background-size:cover;
  background-position:center center;
  background-repeat:no-repeat;
  background-attachment:fixed;
  background-color:#26005c;
}
body.migo-purple-background #room-float-panel{
  background-image:url('assets/migo-purple-background.jpg')!important;
  background-size:cover!important;
  background-position:center center!important;
  background-repeat:no-repeat!important;
  background-attachment:fixed!important;
  background-color:#26005c!important;
}
</style>
"""
if "migo-purple-gold-page-background-v1" in html:
    raise SystemExit("Background style already present; refusing duplicate injection")
if "</head>" not in html:
    raise SystemExit("No closing head tag found")
html = html.replace("</head>", css + "\n</head>", 1)
html_path.write_text(html, encoding="utf-8")
print(f"Applied purple/gold background asset ({out.stat().st_size} bytes) to selected MigoLive sections")
