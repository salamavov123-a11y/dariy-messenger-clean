const express = require("express");
const http = require("http");
const mongoose = require("mongoose");
const cors = require("cors");
const { Server } = require("socket.io");
const admin = require("firebase-admin");
const multer = require("multer");
const bcrypt = require("bcrypt");

const serviceAccount = require("./serviceAccountKey.json");

/* ================= Firebase ================= */

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

/* ================= App ================= */

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static("uploads"));

/* ================= MongoDB ================= */

mongoose.connect(process.env.MONGO_URL);

const User = mongoose.model(
  "User",
  new mongoose.Schema({
    username: { type: String, unique: true },
    password: String,
    fcmToken: String,
  })
);

const Message = mongoose.model(
  "Message",
  new mongoose.Schema({
    chatId: String,
    user: String,
    text: String,
    file: String,
    readBy: [String],
    createdAt: { type: Date, default: Date.now },
  })
);

const Chat = mongoose.model(
  "Chat",
  new mongoose.Schema({
    name: String,
    users: [String],
  })
);

/* ================= AUTH ================= */

app.post("/register", async (req, res) => {
  try {
    const { username, password } = req.body;

    const hash = await bcrypt.hash(password, 10);

    await User.create({ username, password: hash });

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

  res.json({ ok: true, username });
});

/* ================= Upload ================= */

const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (_, file, cb) => cb(null, Date.now() + "_" + file.originalname),
});

const upload = multer({ storage });

app.post("/upload", upload.single("file"), (req, res) => {
  res.json({ file: "/uploads/" + req.file.filename });
});

/* ================= Save FCM token ================= */

app.post("/save-token", async (req, res) => {
  const { username, token } = req.body;

  await User.findOneAndUpdate(
    { username },
    { fcmToken: token },
    { upsert: true }
  );

  res.sendStatus(200);
});

/* ================= Unread count ================= */

app.get("/unread/:username", async (req, res) => {
  const count = await Message.countDocuments({
    readBy: { $ne: req.params.username },
  });

  res.json({ count });
});

/* ================= Chats list ================= */

app.get("/chats/:username", async (req, res) => {
  const chats = await Chat.find({ users: req.params.username });

  const result = [];

  for (const chat of chats) {
    const last = await Message.findOne({ chatId: chat._id })
      .sort({ createdAt: -1 });

    result.push({
      _id: chat._id,
      name: chat.name,
      lastMessage: last ? last.text : "",
    });
  }

  res.json(result);
});

/* ================= Test push ================= */

app.get("/test-push", async (_, res) => {
  const users = await User.find({ fcmToken: { $ne: null } });
  const tokens = users.map((u) => u.fcmToken);

  if (tokens.length === 0) return res.send("no tokens");

  await admin.messaging().sendEachForMulticast({
    tokens,
    notification: {
      title: "ТЕСТ",
      body: "Push работает 🚀",
    },
  });

  res.send("ok");
});

/* ================= Socket.IO ================= */

io.on("connection", (socket) => {
  console.log("User connected");

  socket.on("join_chat", (chatId) => {
    socket.join(chatId);
  });

  socket.on("send_message", async (msg) => {
    const saved = await Message.create({
      ...msg,
      readBy: [msg.user],
    });

    io.to(msg.chatId).emit("new_message", saved);

    /* ===== Push ===== */
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
          data: {
            chatId: msg.chatId.toString(),
          },
        });
      }
    } catch (e) {
      console.log("Push error:", e.message);
    }
  });

  socket.on("read_messages", async ({ chatId, user }) => {
    await Message.updateMany(
      { chatId, readBy: { $ne: user } },
      { $push: { readBy: user } }
    );
  });
});

/* ================= Start ================= */

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
