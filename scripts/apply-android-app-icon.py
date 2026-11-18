#!/usr/bin/env python3
"""Install a verified legacy + adaptive Android launcher icon."""
from pathlib import Path
import shutil
import xml.etree.ElementTree as ET

root = Path("android/app/src/main")
res = root / "res"
source = Path("assets/migo-app-icon.png")
manifest = root / "AndroidManifest.xml"
if not source.is_file() or source.stat().st_size < 4096:
    raise SystemExit("Launcher artwork is missing or too small")
if not manifest.is_file():
    raise SystemExit("AndroidManifest.xml missing")

# Density fallbacks for launchers that use legacy bitmap resources.
for density in ("mipmap-mdpi","mipmap-hdpi","mipmap-xhdpi","mipmap-xxhdpi","mipmap-xxxhdpi"):
    folder = res / density
    folder.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, folder / "ic_launcher.png")
    shutil.copy2(source, folder / "ic_launcher_round.png")

# Android 8+ launchers prefer adaptive XML over the legacy PNGs.
drawable = res / "drawable-nodpi"
drawable.mkdir(parents=True, exist_ok=True)
shutil.copy2(source, drawable / "migo_launcher_foreground.png")
values = res / "values"
values.mkdir(parents=True, exist_ok=True)
colors = values / "migo_launcher_colors.xml"
colors.write_text('''<?xml version="1.0" encoding="utf-8"?>
<resources><color name="migo_launcher_background">#26005B</color></resources>
''', encoding="utf-8")
adaptive_dir = res / "mipmap-anydpi-v26"
adaptive_dir.mkdir(parents=True, exist_ok=True)
adaptive = '''<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/migo_launcher_background"/>
    <foreground android:drawable="@drawable/migo_launcher_foreground"/>
</adaptive-icon>
'''
(adaptive_dir / "ic_launcher.xml").write_text(adaptive, encoding="utf-8")
(adaptive_dir / "ic_launcher_round.xml").write_text(adaptive, encoding="utf-8")

xml = manifest.read_text(encoding="utf-8")
if 'android:icon="@mipmap/ic_launcher"' not in xml:
    raise SystemExit("Manifest does not reference @mipmap/ic_launcher")
if 'android:roundIcon="@mipmap/ic_launcher_round"' not in xml:
    xml = xml.replace('android:icon="@mipmap/ic_launcher"', 'android:icon="@mipmap/ic_launcher" android:roundIcon="@mipmap/ic_launcher_round"', 1)
manifest.write_text(xml, encoding="utf-8")

# Verify that both manifest references and all selected resource files exist.
if '@mipmap/ic_launcher' not in xml or not (adaptive_dir / "ic_launcher.xml").is_file():
    raise SystemExit("Launcher icon resource verification failed")
print("Verified adaptive and legacy Migo Live launcher icons")
