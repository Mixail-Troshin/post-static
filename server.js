/* Простая серверная часть без БД и dotenv
   - Хранение пользователей и настроек в config.json
   - Хранение статей в articles.json
   - Авторизация по JWT в httpOnly cookie
   - Обновление метрик VC через публичный API v2.10/content?id=...
*/
const path = require("path");
const fs = require("fs");
const express = require("express");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");

const app = express();
const PORT = process.env.PORT || 3000;

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const CONFIG_PATH = path.join(ROOT, "config.json");
const ARTICLES_PATH = path.join(ROOT, "articles.json");
const TOKEN_COOKIE = "vc_metrics_token";

// ---------- utils: files ----------
function readJson(p, fallback) {
  if (!fs.existsSync(p)) {
    if (fallback !== undefined) fs.writeFileSync(p, JSON.stringify(fallback, null, 2));
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
function writeJson(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

// ---------- config / state ----------
let config = readJson(CONFIG_PATH, {
  jwtSecret: "change-me-please",
  placementPrice: 15000,
  smtp: { host: "", port: 465, secure: true, user: "", pass: "", from: "" },
  users: [
    // админ по умолчанию: admin@local / admin (хеш пароля ниже)
    {
      email: "admin@local",
      passwordHash: "$2b$12$bF9/3pVaCM6L8BGZokmM8ecGfiY/WcKoIa/jv03gRrBTr2VQkVb2C",
      isAdmin: true
    }
  ]
});
function saveConfig() { writeJson(CONFIG_PATH, config); }

readJson(ARTICLES_PATH, []); // создадим файл, если нет

// ---------- middleware ----------
app.use(express.json());
app.use(cookieParser());
app.use(express.static(PUBLIC, { index: false }));

function signToken(user) {
  return jwt.sign({ email: user.email, isAdmin: !!user.isAdmin }, config.jwtSecret, { expiresIn: "7d" });
}
function authRequired(req, res, next) {
  const raw = req.cookies[TOKEN_COOKIE] || (req.headers.authorization || "").replace(/^Bearer /, "");
  if (!raw) return res.status(401).json({ error: "UNAUTHORIZED" });
  try {
    req.user = jwt.verify(raw, config.jwtSecret);
    next();
  } catch {
    return res.status(401).json({ error: "INVALID_TOKEN" });
  }
}
function adminOnly(req, res, next) {
  if (req.user?.isAdmin) return next();
  return res.status(403).json({ error: "FORBIDDEN" });
}

// ---------- helpers ----------
function extractIdFromUrl(url) {
  // https://vc.ru/marketing/2317921-zapret-reklamy-v-instagram-v-2025 -> 2317921
  const m = String(url).match(/\/(\d+)(?:-[^\/]*)?$/);
  if (m) return parseInt(m[1], 10);
  const any = String(url).match(/(\d{5,})/);
  return any ? parseInt(any[1], 10) : null;
}
async function fetchVcContent(id) {
  const res = await fetch(`https://api.vc.ru/v2.10/content?id=${id}&markdown=false`, {
    headers: { accept: "application/json" }
  });
  if (!res.ok) throw new Error(`VC API ${res.status}`);
  return res.json();
}
function loadArticles() { return readJson(ARTICLES_PATH, []); }
function saveArticles(list) { writeJson(ARTICLES_PATH, list); }

async function maybeSendEmail(to, subject, text) {
  const s = config.smtp || {};
  if (!s.host) return { sent: false, reason: "SMTP_NOT_CONFIGURED" };
  const transporter = nodemailer.createTransport({
    host: s.host,
    port: s.port || 465,
    secure: s.secure !== false,
    auth: s.user ? { user: s.user, pass: s.pass } : undefined
  });
  await transporter.sendMail({ from: s.from || s.user, to, subject, text });
  return { sent: true };
}

// ---------- auth API ----------
app.post("/api/login", (req, res) => {
  const { email, password } = req.body || {};
  const user = (config.users || []).find(u => u.email.toLowerCase() === String(email || "").toLowerCase());
  if (!user || !bcrypt.compareSync(String(password || ""), user.passwordHash)) {
    return res.status(401).json({ error: "INVALID_CREDENTIALS" });
  }
  const token = signToken(user);
  res.cookie(TOKEN_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: false, maxAge: 7 * 24 * 3600 * 1000 });
  res.json({ ok: true, user: { email: user.email, isAdmin: !!user.isAdmin } });
});
app.post("/api/logout", (req, res) => { res.clearCookie(TOKEN_COOKIE); res.json({ ok: true }); });
app.get("/api/me", authRequired, (req, res) => { res.json({ user: req.user }); });

// ---------- articles API ----------
app.get("/api/articles", authRequired, (req, res) => {
  const items = loadArticles().sort((a, b) => (b.date || 0) - (a.date || 0));
  res.json({ items, placementPrice: config.placementPrice || 0 });
});

app.post("/api/articles", authRequired, async (req, res) => {
  const { url } = req.body || {};
  const id = extractIdFromUrl(url);
  if (!id) return res.status(400).json({ error: "BAD_URL" });

  let list = loadArticles();
  const dup = list.find(x => x.id === id);
  if (dup) return res.json({ ok: true, duplicated: true, item: dup });

  try {
    const data = await fetchVcContent(id);
    const r = data.result || {};
    const c = r.counters || {};
    const item = {
      id,
      url: r.url || url,
      title: r.title || "",
      date: r.date || Math.floor(Date.now() / 1000),
      counters: {
        views: c.views || 0,
        hits: c.hits || 0,
        comments: c.comments || 0,
        favorites: c.favorites || 0,
        reposts: c.reposts || 0
      },
      lastUpdated: Math.floor(Date.now() / 1000)
    };
    list.push(item);
    saveArticles(list);
    res.json({ ok: true, item });
  } catch (e) {
    res.status(502).json({ error: "FETCH_FAILED", detail: e.message });
  }
});

app.patch("/api/articles/:id/refresh", authRequired, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const list = loadArticles();
  const idx = list.findIndex(x => x.id === id);
  if (idx === -1) return res.status(404).json({ error: "NOT_FOUND" });

  try {
    const data = await fetchVcContent(id);
    const r = data.result || {};
    const c = r.counters || {};
    list[idx] = {
      ...list[idx],
      title: r.title || list[idx].title,
      url: r.url || list[idx].url,
      date: r.date || list[idx].date,
      counters: {
        views: c.views || 0,
        hits: c.hits || 0,
        comments: c.comments || 0,
        favorites: c.favorites || 0,
        reposts: c.reposts || 0
      },
      lastUpdated: Math.floor(Date.now() / 1000)
    };
    saveArticles(list);
    res.json({ ok: true, item: list[idx] });
  } catch (e) {
    res.status(502).json({ error: "FETCH_FAILED", detail: e.message });
  }
});

app.delete("/api/articles/:id", authRequired, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const next = loadArticles().filter(x => x.id !== id);
  saveArticles(next);
  res.json({ ok: true });
});

// Обновить все (для админа)
app.post("/api/refresh-all", authRequired, adminOnly, async (req, res) => {
  const list = loadArticles();
  const results = [];
  for (const it of list) {
    try {
      const data = await fetchVcContent(it.id);
      const r = data.result || {};
      const c = r.counters || {};
      it.title = r.title || it.title;
      it.url = r.url || it.url;
      it.date = r.date || it.date;
      it.counters = {
        views: c.views || 0,
        hits: c.hits || 0,
        comments: c.comments || 0,
        favorites: c.favorites || 0,
        reposts: c.reposts || 0
      };
      it.lastUpdated = Math.floor(Date.now() / 1000);
      results.push({ id: it.id, ok: true });
    } catch (e) {
      results.push({ id: it.id, ok: false, error: e.message });
    }
  }
  saveArticles(list);
  res.json({ ok: true, results });
});

// ---------- users API (админка) ----------
app.get("/api/users", authRequired, adminOnly, (req, res) => {
  const users = (config.users || []).map(u => ({ email: u.email, isAdmin: !!u.isAdmin }));
  res.json({ users });
});
function randomPass(len = 12) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@$%";
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}
app.post("/api/users", authRequired, adminOnly, async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: "NO_EMAIL" });
  if ((config.users || []).some(u => u.email.toLowerCase() === String(email).toLowerCase())) {
    return res.status(409).json({ error: "ALREADY_EXISTS" });
  }
  const pwd = randomPass();
  const user = { email, passwordHash: bcrypt.hashSync(pwd, 10), isAdmin: false };
  config.users = config.users || [];
  config.users.push(user);
  saveConfig();
  const mail = await maybeSendEmail(email, "Доступ к VC Metrics", `Ваш пароль: ${pwd}`);
  res.json({ ok: true, email, password: pwd, mailed: mail.sent });
});
app.post("/api/users/reset", authRequired, adminOnly, async (req, res) => {
  const { email } = req.body || {};
  const user = (config.users || []).find(u => u.email.toLowerCase() === String(email).toLowerCase());
  if (!user) return res.status(404).json({ error: "NOT_FOUND" });
  const pwd = randomPass();
  user.passwordHash = bcrypt.hashSync(pwd, 10);
  saveConfig();
  const mail = await maybeSendEmail(email, "Сброс пароля VC Metrics", `Новый пароль: ${pwd}`);
  res.json({ ok: true, email, password: pwd, mailed: mail.sent });
});

// ---------- SPA fallback ----------
app.get("*", (req, res) => res.sendFile(path.join(PUBLIC, "index.html")));

// ---------- scheduler: раз в сутки ----------
setInterval(async () => {
  try {
    const list = loadArticles();
    for (const it of list) {
      const data = await fetchVcContent(it.id);
      const r = data.result || {};
      const c = r.counters || {};
      it.title = r.title || it.title;
      it.url = r.url || it.url;
      it.date = r.date || it.date;
      it.counters = {
        views: c.views || 0,
        hits: c.hits || 0,
        comments: c.comments || 0,
        favorites: c.favorites || 0,
        reposts: c.reposts || 0
      };
      it.lastUpdated = Math.floor(Date.now() / 1000);
    }
    saveArticles(list);
  } catch {}
}, 24 * 60 * 60 * 1000);

app.listen(PORT, () => console.log(`VC Metrics listening on ${PORT}`));
