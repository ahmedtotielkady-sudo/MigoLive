"use strict";
const SY=[["W",4],["S",4],["P",5],["O",5],["C",5],["D",8],["F",8],["H",8],["A",12],["E",13],["N",14],["Y",14]];
const REG=SY.map(x=>x[0]).filter(x=>x!=="W"&&x!=="S");
const PAY={P:[0,0,0,10,50,250],O:[0,0,0,10,50,250],C:[0,0,0,10,50,250],D:[0,0,0,6,24,120],F:[0,0,0,6,24,120],H:[0,0,0,6,24,120],A:[0,0,0,3,10,45],E:[0,0,0,3,10,45],N:[0,0,0,3,10,45],Y:[0,0,0,3,10,45]};
const BETS=[10,100,200,500,1000,2000,5000,10000];
function pick(list,random){let n=random()*list.reduce((s,x)=>s+x[1],0);for(const x of list){n-=x[1];if(n<0)return x[0]}return list[list.length-1][0]}
function play({bet,freeSpin=false,random=Math.random}){
 if(!BETS.includes(bet))throw Object.assign(new Error("قيمة الرهان غير مسموح بها"),{status:400});
 const grid=Array.from({length:5},(_,r)=>Array.from({length:4},()=>pick(SY.filter(x=>!(x[0]==="W"&&(r===0||r===4))),random)));
 let win=0,scatters=0;const hits=[];
 for(const symbol of REG){let ways=1,cols=0,positions=[];for(let c=0;c<5;c++){const rows=grid[c].map((v,i)=>v===symbol||v==="W"?i:-1).filter(i=>i>=0);if(!rows.length)break;ways*=rows.length;positions.push(...rows.map(r=>c+":"+r));cols++}if(cols>=3){win+=PAY[symbol][cols]*ways*(bet/100);hits.push(...positions)}}
 for(const col of grid)for(const s of col)if(s==="S")scatters++;
 const extra=scatters>=3?[0,0,0,10,15,20][Math.min(scatters,5)]:0;
 if(scatters>=3)win+=bet*[0,0,0,2,10,50][Math.min(scatters,5)];
 return {grid,win:Math.max(0,Math.round(win)),freeSpins:freeSpin?0:extra,hits,scatters};
}
module.exports={play,BETS};
