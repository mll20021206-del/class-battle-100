const socket=io();let roomCode=null,players=[];
const $=id=>document.getElementById(id);
$("createBtn").onclick=async()=>{const r=await fetch("/api/create-room");const d=await r.json();roomCode=d.code;$("qr").src=d.qr;$("roomCode").textContent=d.code;$("createBox").hidden=true;$("roomBox").hidden=false;socket.emit("host:join",{roomCode});};
socket.on("room:update",room=>{players=room.players;$("count").textContent=players.length;$("startBtn").disabled=!players.length;renderPlayers();renderScores();if(room.state==="finished")showFinish();});
function renderPlayers(){$("players").innerHTML=players.map(p=>`<span class="${p.team==="红队"?"red":"blue"}">${esc(p.name)}</span>`).join("");}
function renderScores(){let r=0,b=0;players.forEach(p=>p.team==="红队"?r+=p.score:b+=p.score);$("redScore").textContent=r;$("blueScore").textContent=b;const rank=[...players].sort((a,b)=>b.score-a.score).slice(0,10);$("miniRank").innerHTML=rank.map(p=>`<li><span>${esc(p.name)}</span><b>${p.score}</b></li>`).join("");if(!$("game").hidden){$("answered").textContent=players.filter(p=>p.answered).length;$("totalPlayers").textContent=players.length;}}
$("startBtn").onclick=()=>socket.emit("host:start",{roomCode});
socket.on("game:question",q=>{$("lobby").hidden=true;$("finish").hidden=true;$("game").hidden=false;$("round").textContent=`第 ${q.index+1}/${q.total} 轮 · ${q.title}`;$("qTitle").textContent=q.title;$("qText").textContent=q.question;$("qOptions").innerHTML=q.options.map((x,i)=>`<div><b>${String.fromCharCode(65+i)}</b>${esc(x)}</div>`).join("");$("answered").textContent="0";$("totalPlayers").textContent=players.length;});
$("nextBtn").onclick=()=>socket.emit("host:next",{roomCode});
socket.on("game:finished",()=>showFinish());
function showFinish(){$("lobby").hidden=true;$("game").hidden=true;$("finish").hidden=false;let r=0,b=0;players.forEach(p=>p.team==="红队"?r+=p.score:b+=p.score);$("winner").textContent=r===b?"红蓝两队平局！":`${r>b?"🔴 红队":"🔵 蓝队"} 获胜！`;const rank=[...players].sort((a,b)=>b.score-a.score);$("ranking").innerHTML=rank.slice(0,10).map((p,i)=>`<div class="rank-row"><b>#${i+1}</b><span>${esc(p.name)}</span><strong>${p.score} 分</strong></div>`).join("");}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
