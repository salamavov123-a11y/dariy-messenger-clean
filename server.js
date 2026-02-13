const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

/* ===== Хранилище пользователей (временно в памяти) ===== */
let users = [];

/* ===== Middleware ===== */
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

/* ===== Главная страница ===== */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

/* ===== Регистрация ===== */
app.post("/register", (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.json({ success: false, message: "Заполни все поля" });
  }

  const exists = users.find(u => u.username === username);
  if (exists) {
    return res.json({ success: false, message: "Пользователь уже существует" });
  }

  users.push({ username, password });

  res.json({ success: true });
});

/* ===== Вход ===== */
app.post("/login", (req, res) => {
  const { username, password } = req.body;

  const user = users.find(
    u => u.username === username && u.password === password
  );

  if (!user) {
    return res.json({ success: false });
  }

  res.json({ success: true });
});

/* ===== Проверка сервера ===== */
app.get("/ping", (req, res) => {
  res.send("Server working");
});

/* ===== Запуск ===== */
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
