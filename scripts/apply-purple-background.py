from pathlib import Path

html_path = Path("www/index.html")
image_path = Path("assets/migo-purple-background.svg")
if not html_path.is_file() or not image_path.is_file():
    raise SystemExit("Missing MigoLive page or purple background artwork")
html = html_path.read_text(encoding="utf-8")
marker = "document.body.classList.toggle('inroom',!!room);"
replacement = marker + "\n  document.body.classList.toggle('migo-purple-background', ['rooms','games','msgs','me','owner','agency','hostperf'].includes(tab) || !!room);"
if html.count(marker) != 1:
    raise SystemExit(f"Expected one render background hook, found {html.count(marker)}")
html = html.replace(marker, replacement, 1)
css = """
<style id="migo-purple-gold-page-background-v1">
body.migo-purple-background #main{background-image:url('assets/migo-purple-background.svg');background-size:cover;background-position:center center;background-repeat:no-repeat;background-attachment:fixed;background-color:#26005c}
body.migo-purple-background #room-float-panel{background-image:url('assets/migo-purple-background.svg')!important;background-size:cover!important;background-position:center center!important;background-repeat:no-repeat!important;background-attachment:fixed!important;background-color:#26005c!important}
</style>
"""
if "migo-purple-gold-page-background-v1" in html:
    raise SystemExit("Background style already present; refusing duplicate injection")
if "</head>" not in html:
    raise SystemExit("No closing head tag found")
html = html.replace("</head>", css + "\n</head>", 1)
html_path.write_text(html, encoding="utf-8")
print("Applied scalable purple/gold background to requested MigoLive sections")
