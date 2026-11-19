#!/usr/bin/env python3
"""Create and install a valid adaptive + legacy Migo Live launcher icon."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import shutil

root = Path("android/app/src/main")
res = root / "res"
source = Path("assets/migo-app-icon.png")
manifest = root / "AndroidManifest.xml"
if not manifest.is_file():
    raise SystemExit("AndroidManifest.xml missing")

# The checked-in artwork has previously been packaged as a damaged PNG.
# Validate it before use; never ship a broken bitmap that Android replaces
# with its generic launcher placeholder.
valid_source = False
if source.is_file() and source.stat().st_size >= 4096:
    try:
        with Image.open(source) as test:
            test.verify()
        valid_source = True
    except Exception:
        valid_source = False

def font(size, bold=True):
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf",
    ]
    for candidate in candidates:
        if Path(candidate).is_file():
            return ImageFont.truetype(candidate, size)
    return ImageFont.load_default()

# Rebuild a clean, high-resolution brand mark if the source PNG is invalid.
# Keep all foreground artwork inside the Android adaptive-icon safe zone.
if valid_source:
    with Image.open(source) as im:
        artwork = im.convert("RGBA").resize((512, 512), Image.Resampling.LANCZOS)
    # Full-bleed legacy icon from the validated supplied art.
    legacy = artwork.copy()
    foreground = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    foreground.alpha_composite(artwork)
else:
    foreground = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    d = ImageDraw.Draw(foreground)
    gold = (255, 210, 75, 255)
    light = (255, 239, 170, 255)
    # Crown, central jewel and bold M monogram.
    d.polygon([(118,190),(105,95),(185,150),(256,65),(327,150),(407,95),(394,190)], fill=gold, outline=light)
    d.rounded_rectangle((112,178,400,218), radius=15, fill=(173,104,16,255), outline=light, width=7)
    d.ellipse((230,165,282,217), fill=(160,16,70,255), outline=light, width=8)
    d.rounded_rectangle((92,238,420,430), radius=54, fill=(46,12,79,255), outline=gold, width=12)
    mf = font(168)
    box = d.textbbox((0,0),"M",font=mf,stroke_width=2)
    d.text(((512-(box[2]-box[0]))/2,222),"M",font=mf,fill=light,stroke_width=3,stroke_fill=(115,62,9,255))
    lf = font(43)
    label = "MIGO LIVE"
    b = d.textbbox((0,0),label,font=lf)
    d.text(((512-(b[2]-b[0]))/2,440),label,font=lf,fill=gold)
    legacy = Image.new("RGBA",(512,512),(38,0,91,255))
    legacy.alpha_composite(foreground)
    # Add a thin gold outer frame to distinguish the launcher tile.
    ImageDraw.Draw(legacy).rounded_rectangle((9,9,503,503),radius=100,outline=gold,width=12)

# Save normalized PNGs with valid chunks and density-appropriate sizes.
drawable = res / "drawable-nodpi"
drawable.mkdir(parents=True, exist_ok=True)
foreground.save(drawable / "migo_launcher_foreground.png", format="PNG", optimize=True)
for density, size in [("mipmap-mdpi",48),("mipmap-hdpi",72),("mipmap-xhdpi",96),("mipmap-xxhdpi",144),("mipmap-xxxhdpi",192)]:
    folder = res / density
    folder.mkdir(parents=True, exist_ok=True)
    icon = legacy.resize((size,size),Image.Resampling.LANCZOS)
    icon.save(folder / "ic_launcher.png",format="PNG",optimize=True)
    icon.save(folder / "ic_launcher_round.png",format="PNG",optimize=True)

values = res / "values"
values.mkdir(parents=True, exist_ok=True)
(values / "migo_launcher_colors.xml").write_text('''<?xml version="1.0" encoding="utf-8"?>
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

# Validate PNG decoding and all launcher references before Gradle packaging.
for p in [drawable / "migo_launcher_foreground.png", *(res / d / "ic_launcher.png" for d in ("mipmap-mdpi","mipmap-hdpi","mipmap-xhdpi","mipmap-xxhdpi","mipmap-xxxhdpi"))]:
    with Image.open(p) as im:
        im.verify()
if not (adaptive_dir / "ic_launcher.xml").is_file() or '@mipmap/ic_launcher' not in xml:
    raise SystemExit("Launcher icon resource verification failed")
print("Verified valid Migo Live launcher PNGs, adaptive icon XML, and manifest references")
