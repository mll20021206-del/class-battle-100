const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const QRCode = require("qrcode");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  transports: ["websocket", "polling"]
});

app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const PUBLIC_URL = process.env.PUBLIC_URL || "";

const rooms = new Map();

const questions = [
  {
    type: "quiz",
    title: "极速答题",
    question: "电功率的国际单位是？",
    options: ["伏特 V", "安培 A", "瓦特 W", "欧姆 Ω"],
    answer: 2,
    points: 100
  },
  {
    type: "quiz",
    title: "反应挑战",
    question: "1 kW 等于多少 W？",
    options: ["10", "100", "1000", "10000"],
    answer: 2,
    points: 100
  },
  {
    type: "vote",
    title: "全班默契挑战",
    question: "如果明天突然放假，你最想做什么？",
    options: ["睡觉", "出去玩", "打游戏", "回家"],
    points: 120
  },
  {
    type: "quiz",
    title: "图片脑洞（演示版）",
    question: "哪一种能源属于可再生能源？",
    options: ["煤炭", "石油", "太阳能", "天然气"],
    answer: 2,
    points: 120
  },
  {
    type: "quiz",
    title: "终极抢答",
    question: "交流电的英文缩写通常是？",
    options: ["DC", "AC", "PWM", "CPU"],
    answer: 1,
    points: 200
  }
];

function makeRoomCode() {
  let code;
  do code = String(Math.floor(100000 + Math.random() * 900000));
  while (rooms.has(code));
  return code;
}

function roomPublic(room) {
  return {
    code: room.code,
    state: room.state,
    current: room.current,
    players: [...room.players.values()].map(p => ({
      id: p.id, name: p.name, team: p.team, score: p.score, answered: p.answered
    }))
  };
}

function broadcast(room) {
  io.to(room.code).emit("room:update", roomPublic(room));
}

app.get("/api/create-room", async (req, res) => {
  const code = makeRoomCode();
  const room = {
    code,
    state: "lobby",
    current: -1,
    players: new Map(),
    hostSocket: null,
    startedAt: null
  };
  rooms.set(code, room);

  const base = PUBLIC_URL || `${req.protocol}://${req.get("host")}`;
  const joinUrl = `${base}/player.html?room=${code}`;
  const qr = await QRCode.toDataURL(joinUrl, { width: 500, margin: 1 });

  res.json({ code, joinUrl, qr });
});

app.get("/api/room/:code", (req, res) => {
  const room = rooms.get(req.params.code);
  if (!room) return res.status(404).json({ error: "房间不存在" });
  res.json(roomPublic(room));
});

io.on("connection", socket => {
  socket.on("host:join", ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room) return socket.emit("error:msg", "房间不存在");
    room.hostSocket = socket.id;
    socket.join(roomCode);
    socket.emit("host:ready", { questions });
    broadcast(room);
  });

  socket.on("player:join", ({ roomCode, name }) => {
    const room = rooms.get(roomCode);
    if (!room) return socket.emit("join:error", "房间不存在");
    if (room.state !== "lobby") return socket.emit("join:error", "游戏已经开始");
    if (room.players.size >= 100) return socket.emit("join:error", "房间已满（100人）");

    const cleanName = String(name || "").trim().slice(0, 12);
    if (!cleanName) return socket.emit("join:error", "请输入昵称");

    const team = room.players.size % 2 === 0 ? "红队" : "蓝队";
    room.players.set(socket.id, {
      id: socket.id, name: cleanName, team, score: 0, answered: false
    });
    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.data.isPlayer = true;
    socket.emit("join:ok", { team, playerId: socket.id });
    broadcast(room);
  });

  socket.on("host:start", ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room || socket.id !== room.hostSocket) return;
    if (room.players.size === 0) return socket.emit("error:msg", "还没有同学加入");
    room.state = "playing";
    room.current = 0;
    room.startedAt = Date.now();
    for (const p of room.players.values()) p.answered = false;
    io.to(roomCode).emit("game:question", {
      index: 0, total: questions.length, ...questions[0], answer: undefined
    });
    broadcast(room);
  });

  socket.on("player:answer", ({ roomCode, choice }) => {
    const room = rooms.get(roomCode);
    if (!room || room.state !== "playing") return;
    const p = room.players.get(socket.id);
    if (!p || p.answered) return;

    const q = questions[room.current];
    p.answered = true;

    if (q.type === "quiz") {
      if (Number(choice) === q.answer) p.score += q.points;
    } else if (q.type === "vote") {
      p.vote = Number(choice);
    }

    socket.emit("answer:received");
    broadcast(room);
  });

  socket.on("host:next", ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room || socket.id !== room.hostSocket) return;

    const q = questions[room.current];
    if (q && q.type === "vote") {
      const counts = q.options.map(() => 0);
      for (const p of room.players.values()) {
        if (Number.isInteger(p.vote) && counts[p.vote] !== undefined) counts[p.vote]++;
      }
      const max = Math.max(...counts);
      for (const p of room.players.values()) {
        if (Number.isInteger(p.vote) && counts[p.vote] === max) p.score += q.points;
        delete p.vote;
      }
    }

    room.current++;
    if (room.current >= questions.length) {
      room.state = "finished";
      io.to(roomCode).emit("game:finished", roomPublic(room));
      broadcast(room);
      return;
    }

    for (const p of room.players.values()) p.answered = false;
    const nextQ = questions[room.current];
    io.to(roomCode).emit("game:question", {
      index: room.current, total: questions.length, ...nextQ, answer: undefined
    });
    broadcast(room);
  });

  socket.on("disconnect", () => {
    if (!socket.data.isPlayer) return;
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    room.players.delete(socket.id);
    broadcast(room);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`班级大作战已启动：http://localhost:${PORT}`);
});
