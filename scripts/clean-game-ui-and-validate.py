#!/usr/bin/env python3
"""Polish player-facing game messages and validate all shipped game scripts."""
from pathlib import Path
from html.parser import HTMLParser
import re
import subprocess
import tempfile

ROOT = Path("www")
REPLACEMENTS = {
    "انتهت مهلة الاتصال بالخادم": "انتهت المهلة، حاول مرة أخرى",
    "تعذر الاتصال بالخادم": "تعذر إكمال العملية، حاول مرة أخرى",
    "تعذر تنفيذ الرهان على الخادم، حاول مرة أخرى": "تعذر تنفيذ الرهان، حاول مرة أخرى",
    "الاتصال بالخادم تأخر، سيتم إعادة المحاولة بنفس رقم الجولة": "التنفيذ تأخر، جارٍ إعادة المحاولة بنفس الجولة",
    "الاتصال بالخادم تأخر، جارٍ إعادة المحاولة": "التنفيذ تأخر، جارٍ إعادة المحاولة",
    "جارٍ تأكيد الجولة السابقة من الخادم": "جارٍ تأكيد الجولة السابقة",
    "جاري تأكيد الجولة من الخادم...": "جارٍ تجهيز النتيجة...",
    "جارٍ تأكيد الجولة من الخادم...": "جارٍ تجهيز النتيجة...",
    "جارٍ تأكيد الرهان والنتيجة من الخادم...": "جارٍ تأكيد الرهان والنتيجة...",
    "رصيد المحفظة الوارد من الخادم غير صالح": "تعذر تحديث الرصيد",
    "الخادم لم يرجع رصيد محفظة صالحًا": "تعذر تحديث الرصيد",
    "خدمة الألعاب غير متصلة بالخادم": "الألعاب غير متاحة مؤقتًا",
    "تعذر تحميل رصيد المحفظة": "تعذر تحميل الرصيد",
}
ROOT_GAME_FILES = ["slot-777.html", "slot-ocean-storm.html", "wheel-animals.html"]
GAME_FILES = [
    "games/slot-777.html",
    "games/slot-ocean-storm.html",
    "games/wheel-animals.html",
    "games/cleopatra-gold.html",
    "games/fruit-luck.html",
    "games/rocket-crash.html",
    "games/big-warrior.html",
]

class InlineScripts(HTMLParser):
    def __init__(self):
        super().__init__()
        self.active = False
        self.kind = ""
        self.current = []
        self.scripts = []
    def handle_starttag(self, tag, attrs):
        if tag.lower() == "script":
            attrs = dict(attrs)
            self.active = "src" not in attrs
            self.kind = attrs.get("type", "").lower()
            self.current = []
    def handle_data(self, data):
        if self.active:
            self.current.append(data)
    def handle_endtag(self, tag):
        if tag.lower() == "script" and self.active:
            if self.kind in ("", "text/javascript", "application/javascript", "module"):
                source = "".join(self.current)
                if source.strip():
                    self.scripts.append(source)
            self.active = False

changed = []
for rel in ["index.html", "api-bridge.js", *ROOT_GAME_FILES, *GAME_FILES]:
    path = ROOT / rel
    if not path.is_file():
        raise SystemExit(f"Required app/game asset is missing: {path}")
    source = path.read_text(encoding="utf-8")
    updated = source
    for old, new in REPLACEMENTS.items():
        updated = updated.replace(old, new)
    if updated != source:
        path.write_text(updated, encoding="utf-8")
        changed.append(rel)

# Compile every inline game script before creating the APK. This catches syntax
# errors across all seven shipped games, not only the two legacy smoke-test pages.
checked = 0
for rel in GAME_FILES:
    path = ROOT / rel
    parser = InlineScripts()
    parser.feed(path.read_text(encoding="utf-8"))
    for index, source in enumerate(parser.scripts):
        with tempfile.NamedTemporaryFile("w", suffix=".js", encoding="utf-8") as tmp:
            tmp.write(source)
            tmp.flush()
            result = subprocess.run(["node", "--check", tmp.name], capture_output=True, text=True)
        if result.returncode:
            raise SystemExit(f"JavaScript syntax error in {rel} inline script {index + 1}:\\n{result.stderr}")
        checked += 1

print(f"Player-facing wording cleaned in {len(changed)} asset(s); validated {checked} inline game scripts across seven games.")
