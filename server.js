const express = require("express");
const http = require("http");
const mongoose = require("mongoose");
const cors = require("cors");
const { Server } = require("socket.io");
const multer = require("multer");
const bcrypt = require("bcrypt");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());

/* ===== СТАТИКА (фикс Cannot GET /) ===== */
app.use(express.static(__dirname));
app.use("/uploads", express.static("uploads"));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

/* ===== MongoDB ===== */

mongoose.connect(process.env.MONGO_URL);

const User = mongoose.model("User", new mongoose.Schema({
  username: { type: String, unique: true },
  password: String,
  avatar: String,
  lastSeen: Date,
  online: { type: Boolean, default: false }
}));

const Message = mongoose.model("Message", new mongoose.Schema({
  chatId: String,
  user: String,
  text: String,
  file: String,        // фото / голос
  type: String,        // text | image | voice
  readBy: [String],
  createdAt: { type: Date, default: Date.now }
}));

const Chat = mongoose.model("Chat", new mongoose.Schema({
  name: String,
  users: [String]
}));

/* ===== AUTH ===== */

app.post("/register", async (req, res) => {
  try {
    const { username, password } = req.body;

    const hash = await bcrypt.hash(password, 10);

    await User.create({
      username,
      password: hash
    });

    res.json({ ok: true });
  } catch {
    res.status(400).json({ error: "USER_EXISTS" });
  }
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  const user = await User.findOne({ username });
  if (!user) return res.status(400).json({ error: "NO_USER" });

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(400).json({ error: "WRONG_PASS" });

  res.json({
    ok: true,
    username,
    avatar: user.avatar || ""
  });
});

/* ===== Upload файлов ===== */

const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (_, file, cb) => {
    cb(null, Date.now() + "_" + file.originalname);
  }
});

const upload = multer({ storage });

app.post("/upload", upload.single("file"), (req, res) => {
  res.json({ file: "/uploads/" + req.file.filename });
});

/* ===== Создание чата ===== */

app.post("/create-chat", async (req, res) => {
  const { users, name } = req.body;

  // если личный чат — проверяем существует ли
  if (users.length === 2) {
    const existing = await Chat.findOne({
      users: { $all: users, $size: 2 }
    });

    if (existing) return res.json(existing);
  }

  const chat = await Chat.create({
    name: name || (users.length > 2 ? "Группа" : users.join(", ")),
    users
  });

  res.json(chat);
});

/* ===== Получение чатов пользователя ===== */

app.get("/chats/:username", async (req, res) => {
  const chats = await Chat.find({ users: req.params.username });

  const result = [];

  for (const chat of chats) {
    const last = await Message
      .findOne({ chatId: chat._id })
      .sort({ createdAt: -1 });

    result.push({
      _id: chat._id,
      name: chat.name,
      lastMessage: last
        ? last.type === "voice"
          ? "🎤 Голосовое"
          : last.type === "image"
          ? "📷 Фото"
          : last.text
        : ""
    });
  }

  res.json(result);
});

/* ===== Статус пользователя ===== */

app.get("/status/:username", async (req, res) => {
  const user = await User.findOne({ username: req.params.username });

  if (!user) return res.json({});

  res.json({
    online: user.online,
    lastSeen: user.lastSeen
  });
});

/* ===== Socket.IO ===== */

io.on("connection", (socket) => {

  /* пользователь онлайн */
  socket.on("user_online", async (username) => {
    socket.username = username;

    await User.updateOne(
      { username },
      { online: true }
    );
  });

  /* вход в чат */
  socket.on("join_chat", (chatId) => {
    socket.join(chatId);
  });

  /* отправка сообщения */
  socket.on("send_message", async (msg) => {
    const saved = await Message.create({
      ...msg,
      readBy: [msg.user]
    });

    io.to(msg.chatId).emit("new_message", saved);
  });

  /* отключение */
  socket.on("disconnect", async () => {
    if (!socket.username) return;

    await User.updateOne(
      { username: socket.username },
      {
        online: false,
        lastSeen: new Date()
      }
    );
  });
});

/* ===== Запуск сервера ===== */

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});
