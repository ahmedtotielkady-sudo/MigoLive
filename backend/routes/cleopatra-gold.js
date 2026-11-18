"use strict";
const express=require("express"),mongoose=require("mongoose"),crypto=require("crypto");
const User=require("../models/User"),Wallet=require("../models/Wallet"),WalletTransaction=require("../models/WalletTransaction"),GameRound=require("../models/GameRound"),GameState=require("../models/GameState"),requireAuth=require("../middleware/requireAuth"),requireGameEnabled=require("../middleware/requireGameEnabled"),engine=require("../game-engines/cleopatra-gold");
const router=express.Router();router.use(requireAuth, requireGameEnabled);
router.post("/cleopatra-gold/spin",async(req,res)=>{
 const bet=Number(req.body&&req.body.bet),key=String(req.get("idempotency-key")||"");
 if(!/^[A-Za-z0-9_-]{16,80}$/.test(key))return res.status(400).json({ok:false,message:"معرّف الجولة مطلوب"});
 if(!Number.isSafeInteger(bet)||!engine.BETS.includes(bet))return res.status(400).json({ok:false,message:"قيمة الرهان غير مسموح بها"});
 const session=await mongoose.startSession();
 try{let result;await session.withTransaction(async()=>{
  const prior=await GameRound.findOne({idempotencyKey:key}).session(session);
  if(prior){if(String(prior.userId)!==req.auth.sub||prior.gameId!=="cleopatra-gold"||Number(prior.outcome.requestedBet)!==bet)throw Object.assign(new Error("معرّف الجولة مستخدم لطلب مختلف"),{status:409});const u=await User.findById(req.auth.sub).session(session).select("coins");result={roundId:prior.roundId,coins:u.coins,bet:prior.bet,payout:prior.payout,outcome:prior.outcome,repeated:true};return}
  const user=await User.findOne({_id:req.auth.sub,status:"active"}).session(session).select("coins");if(!user)throw Object.assign(new Error("الحساب غير موجود أو غير نشط"),{status:404});
  let state=await GameState.findOne({userId:user._id,gameId:"cleopatra-gold"}).session(session);if(!state)state=new GameState({userId:user._id,gameId:"cleopatra-gold",freeSpins:0});
  const freeSpin=state.freeSpins>0,cost=freeSpin?0:bet;if(user.coins<cost)throw Object.assign(new Error("رصيدك غير كافٍ"),{status:409});
  const outcome=engine.play({bet,freeSpin});
  if(cost){user.coins-=cost;await WalletTransaction.create([{from:user._id,amount:cost,type:"game_bet",description:"رهان ذهب كليوباترا",idempotencyKey:key+"_bet"}],{session})}else state.freeSpins--;
  if(outcome.win){user.coins+=outcome.win;await WalletTransaction.create([{to:user._id,amount:outcome.win,type:"game_reward",description:"مكسب ذهب كليوباترا",idempotencyKey:key+"_win"}],{session})}
  state.freeSpins+=outcome.freeSpins;await state.save({session});await user.save({session});await Wallet.updateOne({userId:user._id},{$set:{balance:user.coins}},{upsert:true,session});
  const roundId=crypto.randomUUID(),saved={...outcome,requestedBet:bet,freeSpin,freeSpinsRemaining:state.freeSpins};
  const [round]=await GameRound.create([{userId:user._id,gameId:"cleopatra-gold",roundId,idempotencyKey:key,bet:cost,payout:outcome.win,status:outcome.win?"settled":"lost",outcome:saved,settledAt:new Date()}],{session});
  result={roundId:round.roundId,coins:user.coins,bet:cost,payout:outcome.win,outcome:saved,repeated:false};
 });res.json({ok:true,gameId:"cleopatra-gold",...result})}
 catch(e){res.status(e.status||500).json({ok:false,message:e.status?e.message:"تعذر تنفيذ الجولة"})}
 finally{await session.endSession()}
});
module.exports=router;
