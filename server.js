const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const admin = require("firebase-admin");

/* ================= FIREBASE (через ENV) ================= */

if (!process.env.FIREBASE_KEY) {
  throw new Error("FIREBASE_KEY is missing in environment variables");
}

const serviceAccount = JSON.parse(process.env.FIREBASE_KEY);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

/* ================= CONFIG ================= */

const PORT = process.env.PORT || 3000;

if (!process.env.MONGO_URL) {
  throw new Error("MONGO_URL is missing in environment variables");
}

mongoose
  .connect(process.env.MONGO_URL)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.log("MongoDB error:", err.message));

/* ================= APP ================= */

const app = express();
app.use(cors());
app.use(express.json());
app.use("/uploads", express.static("uploads"));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

/* ================= STORAGE (файлы) ================= */

const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({ storage });

/* ================= SCHEMAS ================= */

const User = mongoose.model(
  "User",
  new mongoose.Schema({
    username: String,
    password: String,
    avatar: String,
    fcmToken: String,
  })
);

const Chat = mongoose.model(
  "Chat",
  new mongoose.Schema({
    users: [String],
    isGroup: Boolean,
    name: String,
  })
);

const Message = mongoose.model(
  "Message",
  new mongoose.Schema({
    chatId: String,
    user: String,
    text: String,
    file: String,
    createdAt: { type: Date, default: Date.now },
  })
);

/* ================= AUTH ================= */

app.post("/register", async (req, res) => {
  const { username, password } = req.body;

  const exists = await User.findOne({ username });
  if (exists) return res.status(400).json({ error: "User exists" });

  const user = await User.create({ username, password });
  res.json(user);
});

app.post("/login", async (req, res) => {
  const { username, password, fcmToken } = req.body;

  const user = await User.findOneAndUpdate(
    { username, password },
    { fcmToken },
    { new: true }
  );

  if (!user) return res.status(400).json({ error: "Invalid login" });

  res.json(user);
});

/* ================= AVATAR ================= */

app.post("/avatar/:username", upload.single("avatar"), async (req, res) => {
  const avatarPath = `/uploads/${req.file.filename}`;

  await User.updateOne(
    { username: req.params.username },
    { avatar: avatarPath }
  );

  res.json({ avatar: avatarPath });
});

/* ================= FILE MESSAGE ================= */

app.post("/upload/:chatId/:user", upload.single("file"), async (req, res) => {
  const filePath = `/uploads/${req.file.filename}`;

  const msg = await Message.create({
    chatId: req.params.chatId,
    user: req.params.user,
    file: filePath,
  });

  io.to(msg.chatId).emit("new_message", msg);

  res.json(msg);
});

/* ================= CHATS ================= */

app.get("/chats/:username", async (req, res) => {
  const chats = await Chat.find({ users: req.params.username });
  res.json(chats);
});

app.post("/group", async (req, res) => {
  const { name, users } = req.body;

  const chat = await Chat.create({
    name,
    users,
    isGroup: true,
  });

  res.json(chat);
});

/* ================= MESSAGES ================= */

app.get("/messages/:chatId", async (req, res) => {
  const msgs = await Message.find({ chatId: req.params.chatId }).sort("createdAt");
  res.json(msgs);
});

/* ================= SOCKET ================= */

io.on("connection", (socket) => {
  console.log("User connected");

  socket.on("join", (chatId) => {
    socket.join(chatId);
  });

  socket.on("send_message", async (msg) => {
    const saved = await Message.create(msg);

    io.to(msg.chatId).emit("new_message", saved);

    /* ===== PUSH УВЕДОМЛЕНИЯ ===== */

    try {
      const chat = await Chat.findById(msg.chatId);
      if (!chat) return;

      const users = await User.find({ username: { $in: chat.users } });
      const tokens = users.map((u) => u.fcmToken).filter(Boolean);

      if (tokens.length > 0) {
        await admin.messaging().sendEachForMulticast({
          tokens,
          notification: {
            title: msg.user,
            body: msg.text || "📎 Файл",
          },
        });
      }
    } catch (err) {
      console.log("FCM error:", err.message);
    }
  });
});

/* ================= START ================= */

server.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
