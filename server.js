require("dotenv").config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

/* ================= НАСТРОЙКИ ================= */

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/* ================= MONGODB ================= */

mongoose
  .connect(process.env.MONGO_URL)
  .then(() => console.log("✅ MongoDB подключена"))
  .catch(err => console.log("❌ Ошибка MongoDB:", err));

/* ================= МОДЕЛИ ================= */

const User = mongoose.model(
  "User",
  new mongoose.Schema({
    username: { type: String, unique: true },
    password: String,
    avatar: String,
    createdAt: { type: Date, default: Date.now }
  })
);

const Message = mongoose.model(
  "Message",
  new mongoose.Schema({
    from: String,
    to: String,
    text: String,
    time: { type: Date, default: Date.now }
  })
);

/* ================= ГЛАВНАЯ ================= */

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

/* ================= РЕГИСТРАЦИЯ ================= */

app.post("/api/register", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password)
      return res.json({ error: "Заполни все поля" });

    const exist = await User.findOne({ username });
    if (exist) return res.json({ error: "Пользователь уже существует" });

    const hash = await bcrypt.hash(password, 10);

    await User.create({
      username,
      password: hash
    });

    res.json({ ok: true });
  } catch (err) {
    console.log(err);
    res.json({ error: "Ошибка регистрации" });
  }
});

/* ================= ВХОД ================= */

app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    const user = await User.findOne({ username });
    if (!user) return res.json({ error: "Пользователь не найден" });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.json({ error: "Неверный пароль" });

    res.json({ ok: true, username });
  } catch (err) {
    console.log(err);
    res.json({ error: "Ошибка входа" });
  }
});

/* ================= СПИСОК ПОЛЬЗОВАТЕЛЕЙ ================= */

app.get("/api/users", async (req, res) => {
  const users = await User.find({}, "username avatar");
  res.json(users);
});

/* ================= ПОЛУЧЕНИЕ СООБЩЕНИЙ ================= */

app.get("/api/messages/:a/:b", async (req, res) => {
  const { a, b } = req.params;

  const msgs = await Message.find({
    $or: [
      { from: a, to: b },
      { from: b, to: a }
    ]
  }).sort({ time: 1 });

  res.json(msgs);
});

/* ================= SOCKET.IO ЧАТ ================= */

io.on("connection", socket => {
  console.log("🔌 Пользователь подключился");

  socket.on("join", username => {
    socket.username = username;
    console.log("👤 Вошёл:", username);
  });

  socket.on("sendMessage", async data => {
    try {
      const msg = await Message.create({
        from: data.from,
        to: data.to,
        text: data.text
      });

      io.emit("newMessage", msg);
    } catch (err) {
      console.log("Ошибка отправки:", err);
    }
  });

  socket.on("disconnect", () => {
    console.log("❌ Пользователь отключился");
  });
});

/* ================= ПРОВЕРКА СЕРВЕРА ================= */

app.get("/ping", (req, res) => {
  res.send("Server working ✅");
});

/* ================= ЗАПУСК ================= */

server.listen(PORT, () => {
  console.log("🚀 Сервер запущен на порту " + PORT);
});
