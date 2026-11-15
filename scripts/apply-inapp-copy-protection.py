#!/usr/bin/env python3
"""Disable text selection and copy actions in the MigoLive app UI, while preserving editable controls."""
from pathlib import Path

path = Path("index.html")
html = path.read_text(encoding="utf-8")
style_id = "migo-disable-inapp-copy-style-v1"
script_id = "migo-disable-inapp-copy-script-v1"

css = r"""
<style id="migo-disable-inapp-copy-style-v1">
/* Prevent selecting/copying app content; editable fields remain fully usable. */
html.migo-no-copy, html.migo-no-copy body,
html.migo-no-copy body * {
  -webkit-user-select: none !important;
  user-select: none !important;
  -webkit-touch-callout: none !important;
}
html.migo-no-copy input,
html.migo-no-copy textarea,
html.migo-no-copy select,
html.migo-no-copy [contenteditable="true"],
html.migo-no-copy [contenteditable=""],
html.migo-no-copy .allow-copy,
html.migo-no-copy .allow-copy * {
  -webkit-user-select: text !important;
  user-select: text !important;
  -webkit-touch-callout: default !important;
}
</style>
"""

js = r"""
<script id="migo-disable-inapp-copy-script-v1">
(() => {
  if (window.__migoInAppCopyProtection) return;
  window.__migoInAppCopyProtection = true;
  const root = document.documentElement;
  root.classList.add("migo-no-copy");
  const editable = node => !!(node && node.closest &&
    node.closest('input,textarea,select,[contenteditable="true"],[contenteditable=""],.allow-copy'));
  const block = event => {
    if (editable(event.target)) return;
    event.preventDefault();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
  };
  document.addEventListener("contextmenu", block, true);
  document.addEventListener("selectstart", block, true);
  document.addEventListener("copy", block, true);
  document.addEventListener("cut", block, true);
  document.addEventListener("dragstart", block, true);
})();
</script>
"""

if style_id not in html:
    if "</head>" not in html:
        raise SystemExit("index.html is missing </head>")
    html = html.replace("</head>", css + "\n</head>", 1)
if script_id not in html:
    if "</body>" not in html:
        raise SystemExit("index.html is missing </body>")
    html = html.replace("</body>", js + "\n</body>", 1)
path.write_text(html, encoding="utf-8")
print("Installed in-app copy/selection protection; editable fields remain enabled")
