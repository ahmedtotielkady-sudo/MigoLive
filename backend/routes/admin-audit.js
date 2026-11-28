"use strict";
const express = require("express");
const User = require("../models/User");
const AdminAuditLog = require("../models/AdminAuditLog");
const requireAuth = require("../middleware/requireAuth");
const router = express.Router();
router.use(requireAuth);
router.use(async (req,res,next)=>{
  try {
    const actor=await User.findById(req.auth.sub).select("role status").lean();
    if(!actor||actor.status!=="active"||actor.role!=="owner") return res.status(403).json({ok:false,message:"سجل الرقابة متاح لمالك التطبيق فقط"});
    next();
  } catch(e){next(e);}
});
router.get("/",async(req,res,next)=>{
  try{
    const page=Math.max(1,Math.min(100000,Number.parseInt(req.query.page,10)||1));
    const limit=Math.max(1,Math.min(100,Number.parseInt(req.query.limit,10)||50));
    const filter={};
    if(req.query.targetType) filter.targetType=String(req.query.targetType).slice(0,60);
    if(req.query.action) filter.action=String(req.query.action).slice(0,100);
    if(req.query.uid && /^\\d{1,10}$/.test(String(req.query.uid))) filter.targetId=String(req.query.uid);
    const [total,items]=await Promise.all([
      AdminAuditLog.countDocuments(filter),
      AdminAuditLog.find(filter).sort({createdAt:-1,_id:-1}).skip((page-1)*limit).limit(limit)
        .populate("actorUserId","uid username displayName").lean()
    ]);
    res.json({ok:true,total,page,limit,items:items.map(x=>({
      id:String(x._id),action:x.action,targetType:x.targetType,targetId:x.targetId,
      reason:x.reason||"",metadata:x.metadata||{},createdAt:x.createdAt,
      actor:x.actorUserId?{uid:x.actorUserId.uid,username:x.actorUserId.username,displayName:x.actorUserId.displayName}:null
    }))});
  }catch(e){next(e);}
});
module.exports=router;
