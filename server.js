const express = require("express");
const http = require("http");
const mongoose = require("mongoose");
const cors = require("cors");
const { Server } = require("socket.io");
const multer = require("multer");
const bcrypt = require("bcrypt");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static("uploads"));

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
  file: String,   // фото / файл / голос
  type: String,   // "text" | "image" | "voice"
  createdAt: { type: Date, default: Date.now }
}));

const Chat = mongoose.model("Chat", new mongoose.Schema({
  name: String,
  users: [String]
}));

/* ===== Upload ===== */

const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (_, file, cb) => cb(null, Date.now() + "_" + file.originalname)
});
const upload = multer({ storage });

app.post("/upload", upload.single("file"), (req, res) => {
  res.json({ file: "/uploads/" + req.file.filename });
});

/* ===== Chats ===== */

app.post("/create-chat", async (req, res) => {
  const { users, name } = req.body;

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

app.get("/chats/:username", async (req, res) => {
  const chats = await Chat.find({ users: req.params.username });

  const result = [];
  for (const chat of chats) {
    const last = await Message.findOne({ chatId: chat._id }).sort({ createdAt: -1 });

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

/* ===== Socket.IO ===== */

io.on("connection", (socket) => {

  socket.on("user_online", async (username) => {
    socket.username = username;
    await User.updateOne({ username }, { online: true });
  });

  socket.on("join_chat", (chatId) => {
    socket.join(chatId);
  });

  socket.on("send_message", async (msg) => {
    const saved = await Message.create(msg);
    io.to(msg.chatId).emit("new_message", saved);
  });

  socket.on("disconnect", async () => {
    if (!socket.username) return;
    await User.updateOne(
      { username: socket.username },
      { online: false, lastSeen: new Date() }
    );
  });
});

/* ===== Start ===== */

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server running on", PORT));
