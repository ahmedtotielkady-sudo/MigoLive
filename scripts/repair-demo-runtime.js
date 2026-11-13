const fs = require("node:fs");
const vm = require("node:vm");

const files = [
  "index.html",
  "slot-777.html",
  "games/slot-777.html"
];

function repair(file) {
  if (!fs.existsSync(file)) return;
  let html = fs.readFileSync(file, "utf8");
  if (file === "index.html") {
    html = html.replace("}}\\n else if(d.t==='wallet')", "}}\n else if(d.t==='wallet')");
  }
  if (file.endsWith("slot-777.html")) {
    html = html.replace(
      "modal('5 بكرات × 3 صفوف، 40 خط دفع.\nالرمز يربح من اليسار: 3 أو أكثر (و2 للألماس واللؤلؤ والذهب والأناناس).\nWILD بديل لكل الرموز عدا BONUS ولا يظهر في اللفات المجانية.\n3/4/5 BONUS في أي مكان = 3/6/10 لفات مجانية.'",
      "modal('5 بكرات × 3 صفوف، 40 خط دفع.\\nالرمز يربح من اليسار: 3 أو أكثر (و2 للألماس واللؤلؤ والذهب والأناناس).\\nWILD بديل لكل الرموز عدا BONUS ولا يظهر في اللفات المجانية.\\n3/4/5 BONUS في أي مكان = 3/6/10 لفات مجانية.'"
    );
  }
  fs.writeFileSync(file, html);
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  for (const [i, code] of scripts.entries()) {
    if (!code.trim()) continue;
    new vm.Script(code, { filename: file + "#script-" + i });
  }
  console.log("Syntax OK:", file, "inline scripts:", scripts.filter(x => x.trim()).length);
}

for (const file of files) repair(file);
