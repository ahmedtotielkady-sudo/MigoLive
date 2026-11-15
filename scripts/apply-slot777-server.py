#!/usr/bin/env python3
"""Connect Slot 777 presentation to the authenticated server settlement API."""
from pathlib import Path

path = Path("slot-777.html")
html = path.read_text(encoding="utf-8")
marker = "// MIGO_SERVER_SLOT777_V1"
if marker in html:
    print("Slot 777 server bridge already applied")
    raise SystemExit(0)

old = """async function spin(){
  if(spinning){stopNow=true;return}
  const bet=BASE*MULT[mi],isFree=free>0;
  if(!isFree&&bal<bet){auto=0;updAuto();modal('العملة غير كافية',[['إلغاء',null,'g'],['تعبئة رصيد',toWallet]]);return}
  spinning=true;stopNow=false;
  if(isFree)free--;else bal-=bet;
  $('win').textContent='0';clearHit();upd();
  $('spin').textContent='قف';$('spin').classList.add('stop');
  const g=makeGrid(isFree);
  const ev=evaluate(g,bet),win=ev.win;pend=win;save();
  await Promise.all(cells.map((col,i)=>new Promise(res=>{
    const t=setInterval(()=>{const p=col.map(c=>c._s);setCell(col[2],p[1]);setCell(col[1],p[0]);setCell(col[0],rnd());col.forEach(c=>c.animate([{transform:'translateY(-100%)'},{transform:'none'}],{duration:90}))},90);
    const stopAt=Date.now()+500+i*260;
    const chk=setInterval(()=>{
      if(Date.now()>=stopAt||stopNow){
        clearInterval(t);clearInterval(chk);
        col.forEach((c,r)=>{setCell(c,g[i][r]);c.animate([{transform:'translateY(-140%)'},{transform:'translateY(5%)',offset:.7},{transform:'none'}],{duration:280,easing:'ease-out',delay:(2-r)*60,fill:'backwards'})});beep(300+i*40);setTimeout(res,400);
      }
    },30);
  })));
  bal+=win;pend=0;
  ev.hit.forEach(k=>{const[i,r]=k.split(',');cells[i][r].classList.add('hit')});
  if(win>0){countUp(win);beep(660);setTimeout(()=>beep(880),120)}
  if(ev.bonus>=3){free+=FREE[Math.min(ev.bonus,5)]}
  spinning=false;stopNow=false;
  $('spin').textContent='دوران';$('spin').classList.remove('stop');
  upd();if(ev.bonus>=3)$('msg').textContent='بونص! لفات مجانية: '+free;
  if(free>0)setTimeout(()=>{if(!spinning)spin()},1400);
  else if(auto>0){auto--;updAuto();setTimeout(()=>{if(!spinning)spin()},1000)}
}"""
new = """// MIGO_SERVER_SLOT777_V1
async function requestServerSpin(bet){
  const token=localStorage.getItem('migolive_token');
  if(!token)throw new Error('سجّل الدخول إلى حسابك أولاً');
  const key=(crypto.randomUUID?crypto.randomUUID():('migo_'+Date.now()+'_'+Math.random().toString(36).slice(2,14)));
  const response=await fetch('https://migolive-api-production.up.railway.app/api/games/slot-777/spin',{
    method:'POST',
    headers:{'content-type':'application/json','authorization':'Bearer '+token,'idempotency-key':key},
    body:JSON.stringify({bet}),
    cache:'no-store'
  });
  let data={};try{data=await response.json()}catch(_){}
  if(!response.ok||!data.ok)throw new Error(data.message||'تعذر تنفيذ الجولة على الخادم');
  return data;
}
async function spin(){
  if(spinning){stopNow=true;return}
  const bet=BASE*MULT[mi];
  spinning=true;stopNow=false;auto=auto||0;
  $('win').textContent='0';clearHit();
  $('spin').textContent='جارٍ الاتصال';$('spin').classList.add('stop');
  let result;
  try{result=await requestServerSpin(bet)}
  catch(error){
    spinning=false;stopNow=false;$('spin').textContent='دوران';$('spin').classList.remove('stop');
    auto=0;updAuto();modal(error.message||'تعذر الاتصال بالخادم',[['حسنًا',null,'g']]);return;
  }
  bal=Number(result.coins)||0;
  free=Number(result.freeSpinsRemaining)||0;
  const isFree=!!result.freeSpin;
  const g=result.outcome.grid;
  const win=Number(result.payout)||0;
  const ev={hit:result.outcome.hits||[],bonus:Number(result.outcome.bonus)||0};
  $('win').textContent='0';upd();
  $('spin').textContent='قف';$('spin').classList.add('stop');
  await Promise.all(cells.map((col,i)=>new Promise(res=>{
    const t=setInterval(()=>{const p=col.map(c=>c._s);setCell(col[2],p[1]);setCell(col[1],p[0]);setCell(col[0],rnd());col.forEach(c=>c.animate([{transform:'translateY(-100%)'},{transform:'none'}],{duration:90}))},90);
    const stopAt=Date.now()+500+i*260;
    const chk=setInterval(()=>{
      if(Date.now()>=stopAt||stopNow){
        clearInterval(t);clearInterval(chk);
        col.forEach((c,r)=>{setCell(c,g[i][r]);c.animate([{transform:'translateY(-140%)'},{transform:'translateY(5%)',offset:.7},{transform:'none'}],{duration:280,easing:'ease-out',delay:(2-r)*60,fill:'backwards'})});beep(300+i*40);setTimeout(res,400);
      }
    },30);
  })));
  pend=0;
  ev.hit.forEach(k=>{const[i,r]=k.split(',');cells[i][r].classList.add('hit')});
  if(win>0){countUp(win);beep(660);setTimeout(()=>beep(880),120)}
  spinning=false;stopNow=false;
  $('spin').textContent='دوران';$('spin').classList.remove('stop');
  upd();
  if(ev.bonus>=3)$('msg').textContent='بونص! لفات مجانية: '+free;
  if(free>0)setTimeout(()=>{if(!spinning)spin()},1400);
  else if(auto>0){auto--;updAuto();setTimeout(()=>{if(!spinning)spin()},1000)}
}"""
if html.count(old) != 1:
    raise SystemExit(f"Expected one original spin() function, found {html.count(old)}")
html = html.replace(old, new, 1)
# Remove client-generated fallback balance: a missing server response must never mint coins.
fallback = "setTimeout(()=>{if(!ready&&bal===0){bal=5000;upd()}},1500);"
if html.count(fallback) != 1:
    raise SystemExit("Expected one local 5000-coin fallback")
html = html.replace(fallback, "setTimeout(()=>{if(!ready){modal('تعذر تحميل رصيد المحفظة',[['إعادة المحاولة',()=>location.reload(),'g']])}},5000);", 1)
path.write_text(html, encoding="utf-8")
print("Slot 777 now uses server-generated outcomes and server wallet balance")
