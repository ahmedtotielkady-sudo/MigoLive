#!/usr/bin/env python3
"""Apply the supplied Migo Live artwork as the actual Android launcher icon."""
from pathlib import Path
import shutil

source = Path("assets/migo-app-icon.png")
res = Path("android/app/src/main/res")
if not source.is_file():
    raise SystemExit("Migo Live icon source is missing")
if not (res.parent / "AndroidManifest.xml").is_file():
    raise SystemExit("AndroidManifest.xml missing; run Capacitor Android setup first")

# Android launcher icon resource referenced by the Capacitor manifest.
folders = sorted(p for p in res.glob("mipmap-*") if p.is_dir())
if not folders:
    raise SystemExit("No Android mipmap resource folders found")
for folder in folders:
    shutil.copy2(source, folder / "ic_launcher.png")
    shutil.copy2(source, folder / "ic_launcher_round.png")
    # Android 8+ adaptive XML takes precedence over raster launcher icons.
    # Remove it so Android uses the exact supplied artwork instead.
    for name in ("ic_launcher.xml", "ic_launcher_round.xml"):
        adaptive = folder / name
        if adaptive.exists():
            adaptive.unlink()

manifest = res.parent / "AndroidManifest.xml"
xml = manifest.read_text(encoding="utf-8")
if 'android:icon="@mipmap/ic_launcher"' not in xml:
    raise SystemExit("Manifest does not reference @mipmap/ic_launcher; refusing an unverified icon install")
if 'android:roundIcon="@mipmap/ic_launcher_round"' not in xml:
    xml = xml.replace('android:icon="@mipmap/ic_launcher"', 'android:icon="@mipmap/ic_launcher" android:roundIcon="@mipmap/ic_launcher_round"', 1)
manifest.write_text(xml, encoding="utf-8")
print("Applied Migo Live launcher icon to: " + ", ".join(p.name for p in folders))
