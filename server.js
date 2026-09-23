const express=require("express"),http=require("http"),path=require("path"),QRCode=require("qrcode");
const {Server}=require("socket.io"); const app=express(); app.set("trust proxy",1);
app.use(express.static(path.join(__dirname,"public"))); app.get("/health",(_,r)=>r.send("ok"));
const server=http.createServer(app),io=new Server(server,{transports:["websocket","polling"]});
const PORT=process.env.PORT||3000, rooms=new Map(), TOTAL=5, SECS=60;
const WORDS=[["长颈鹿",["长颈鹿"]],["火箭",["火箭"]],["雨伞",["雨伞","伞"]],["机器人",["机器人"]],["摩天轮",["摩天轮"]],["企鹅",["企鹅"]],["自行车",["自行车","单车"]],["冰淇淋",["冰淇淋","冰激凌","雪糕"]],["飞机",["飞机"]],["向日葵",["向日葵"]]];
const norm=s=>String(s||"").trim().toLowerCase().replace(/\s|[，。！？,.!?、]/g,"");
function code(){let c;do c=String(Math.floor(100000+Math.random()*900000));while(rooms.has(c));return c}
function rank(r){return [...r.players.values()].map(p=>({id:p.id,name:p.name,correct:p.correct,eligible:p.eligible,totalMs:p.totalMs,accuracy:p.eligible?p.correct/p.eligible:0})).sort((a,b)=>b.correct-a.correct||b.accuracy-a.accuracy||a.totalMs-b.totalMs)}
function pub(r){return{code:r.code,state:r.state,round:r.round,remaining:r.remaining,players:[...r.players.values()].map(p=>({id:p.id,name:p.name})),ranking:rank(r).slice(0,10)}}
function bc(r){io.to(r.code).emit("room:update",pub(r))}
function drawer(r){let a=[...r.players.values()].filter(p=>!r.used.has(p.id));if(!a.length){r.used.clear();a=[...r.players.values()]}let p=a[Math.floor(Math.random()*a.length)];r.used.add(p.id);return p}
function startRound(r){if(r.round>=TOTAL)return finish(r);if(r.players.size<2)return;let d=drawer(r);r.drawer=d.id;r.correctSet=new Set();r.started=Date.now();r.remaining=SECS;r.state="drawing";
for(const p of r.players.values()){p.answered=false;if(p.id!==d.id)p.eligible++}
io.to(r.code).emit("round:start",{round:r.round+1,totalRounds:TOTAL,drawerId:d.id,drawerName:d.name,seconds:SECS});
io.to(d.id).emit("drawer:word",{answer:r.words[r.round][0]});bc(r);
r.timer=setInterval(()=>{r.remaining--;io.to(r.code).emit("round:tick",{remaining:r.remaining});if(r.remaining<=0)endRound(r)},1000)}
function endRound(r){if(r.state!=="drawing")return;clearInterval(r.timer);r.state="between";let ans=r.words[r.round][0];io.to(r.code).emit("round:end",{answer:ans,correctCount:r.correctSet.size,nextIn:3});r.round++;bc(r);setTimeout(()=>startRound(r),3000)}
function finish(r){r.state="finished";io.to(r.code).emit("game:finished",{ranking:rank(r)});bc(r)}
app.get("/api/create-room",async(req,res)=>{let c=code(),base=`${req.get("x-forwarded-proto")||req.protocol}://${req.get("x-forwarded-host")||req.get("host")}`,join=`${base}/player.html?room=${c}`,qr=await QRCode.toDataURL(join,{width:500,margin:1});
let words=[...WORDS].sort(()=>Math.random()-.5).slice(0,TOTAL);rooms.set(c,{code:c,state:"lobby",round:0,remaining:0,players:new Map(),host:null,used:new Set(),words});res.json({code:c,joinUrl:join,qr})});
io.on("connection",s=>{
s.on("host:join",({roomCode})=>{let r=rooms.get(roomCode);if(!r)return;r.host=s.id;s.join(roomCode);s.data.room=roomCode;bc(r)});
s.on("player:join",({roomCode,name})=>{let r=rooms.get(roomCode);if(!r)return s.emit("join:error","房间不存在");if(r.state!=="lobby")return s.emit("join:error","游戏已经开始");if(r.players.size>=100)return s.emit("join:error","房间已满");name=String(name||"").trim().slice(0,12);if(!name)return s.emit("join:error","请输入昵称");r.players.set(s.id,{id:s.id,name,correct:0,eligible:0,totalMs:0,answered:false});s.join(roomCode);s.data.room=roomCode;s.data.player=true;s.emit("join:ok");bc(r)});
s.on("host:start",({roomCode})=>{let r=rooms.get(roomCode);if(!r||r.host!==s.id||r.players.size<2)return;r.round=0;r.used.clear();for(const p of r.players.values()){p.correct=0;p.eligible=0;p.totalMs=0}startRound(r)});
s.on("draw:stroke",({roomCode,stroke})=>{let r=rooms.get(roomCode);if(r&&r.state==="drawing"&&r.drawer===s.id)s.to(roomCode).emit("draw:stroke",stroke)});
s.on("draw:clear",({roomCode})=>{let r=rooms.get(roomCode);if(r&&r.drawer===s.id)io.to(roomCode).emit("draw:clear")});
s.on("guess:submit",({roomCode,guess})=>{let r=rooms.get(roomCode),p=r&&r.players.get(s.id);if(!r||r.state!=="drawing"||!p||s.id===r.drawer||p.answered)return;let aliases=r.words[r.round][1];if(aliases.some(a=>norm(a)===norm(guess))){p.answered=true;p.correct++;let ms=Math.min(SECS*1000,Date.now()-r.started);p.totalMs+=ms;r.correctSet.add(s.id);s.emit("guess:result",{correct:true,elapsed:ms});io.to(roomCode).emit("round:correct-count",{count:r.correctSet.size});bc(r)}else s.emit("guess:result",{correct:false})});
s.on("disconnect",()=>{let r=rooms.get(s.data.room);if(r&&s.data.player){let was=r.drawer===s.id;r.players.delete(s.id);if(was&&r.state==="drawing")endRound(r);else bc(r)}})
});server.listen(PORT,"0.0.0.0",()=>console.log("你画我猜V2已启动",PORT));