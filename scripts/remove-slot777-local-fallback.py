#!/usr/bin/env python3
"""Remove the legacy Slot 777 fallback that minted 5,000 local coins."""
from pathlib import Path
path = Path("slot-777.html")
html = path.read_text(encoding="utf-8")
legacy = "setTimeout(()=>{if(!ready&&bal===0){bal=5000;upd()}},1500);"
if legacy in html:
    html = html.replace(legacy, "setTimeout(()=>{if(!ready){modal('تعذر تحميل رصيد المحفظة',[['إعادة المحاولة',()=>location.reload(),'g']])}},5000);", 1)
if "bal=5000" in html:
    raise SystemExit("Unsafe local 5,000-coin fallback remains in Slot 777")
path.write_text(html, encoding="utf-8")
print("Removed local Slot 777 coin fallback")
