// server.js (CommonJS)
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");

// ---------- helpers ----------
const isProd = process.env.NODE_ENV === "production";
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const STORAGE_DIR = path.join(ROOT, "storage");
const USERS_PATH = path.join(STORAGE_DIR, "users.json");
const DATA_PATH = path.join(STORAGE_DIR, "data.json");

// обеспечиваем storage
if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true });

// если нет users.json — создаём с дефолтным админом admin@local / admin
if (!fs.existsSync(USERS_PATH)) {
  const defaultAdmin = {
    id: "u1",
    email: "admin@local",
    // это хеш для пароля "admin" (bcrypt, cost 12)
    passwordHash: "$2b$12$bF9/3pVaCM6L8BGZokmM8ecGfiY/WcKoIa/jv03gRrBTr2VQkVb2C",
    isAdmin: true
  };
  fs.writeFileSync(USERS_PATH, JSON.stringify([defaultAdmin], null, 2));
}

// если нет data.json — создаём пустую базу
if (!fs.existsSync(DATA_PATH)) {
  const init = { placementPrice: 0, items: [] };
  fs.writeFileSync(DATA_PATH, JSON.stringify(init, null, 2));
}

function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return null; }
}
function writeJSON(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
}

function readUsers() { return readJSON(USERS_PATH) || []; }
function readData() { return readJSON(DATA_PATH) || { placementPrice: 0, items: [] }; }

function extractIdFromUrl(input) {
  try {
    const u = new URL(input);
    // варианты:
    // 1) .../marketing/2317921-zapret-...
    // 2) ...?id=2303745
    const qid = u.searchParams.get("id");
    if (qid && /^\d+$/.test(qid)) return Number(qid);
    const m = u.pathname.match(/\/(\d+)(?:-[^\/?#]+)?(?:[\/?#]|$)/);
    if (m) return Number(m[1]);
  } catch { /* noop */ }
  return null;
}

async function fetchVCContentById(id) {
  // Node 18+ — глобальный fetch доступен
  const url = `https://api.vc.ru/v2.10/content?id=${encodeURIComponent(id)}&markdown=false`;
  const headers = { "accept": "application/json" };

  // опционально — если задашь переменные окружения, они добавятся:
  if (process.env.VC_JWT) headers["jwtauthorization"] = `Bearer ${process.env.VC_JWT}`;
  if (process.env.VC_COOKIES) headers["cookie"] = process.env.VC_COOKIES;

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`VC API ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (!json?.result) throw new Error("VC API: пустой результат");
  return json.result;
}

function normalizeItemFromVC(result) {
  // результат VC ru
  // берем только необходимое
  return {
    id: result.id,
    url: result.url,
    title: result.title,
    date: result.date, // unix seconds
    counters: {
      views: result.counters?.views ?? 0, // показы в ленте
      hits: result.counters?.hits ?? 0,   // открытия статьи
      comments: result.counters?.comments ?? 0,
      favorites: result.counters?.favorites ?? 0,
      reposts: result.counters?.reposts ?? 0
    },
    lastUpdated: Date.now()
  };
}

// ---------- app ----------
const app = express();
app.set("trust proxy", 1);
app.use(express.json());

// Сессии
app.use(session({
  secret: process.env.SESSION_SECRET || "dev_secret_change_me",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd, // на Render по https будет true
    maxAge: 30 * 24 * 3600 * 1000
  }
}));

// статика
app.use(express.static(path.join(ROOT, "public")));

// ---------- auth middlewares ----------
function requireAuth(req, res, next) {
  const users = readUsers();
  const u = users.find(x => x.id === req.session.userId);
  if (!u) return res.status(401).json({ error: "Unauthorized" });
  req.user = u;
  next();
}
function requireAdmin(req, res, next) {
  if (!req.user?.isAdmin) return res.status(403).json({ error: "Forbidden" });
  next();
}

// ---------- auth routes ----------
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "Введите e-mail и пароль" });
    }
    const users = readUsers();
    const user = users.find(u => u.email?.toLowerCase() === String(email).toLowerCase());
    if (!user) return res.status(401).json({ error: "Неверный логин/пароль" });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "Неверный логин/пароль" });

    req.session.userId = user.id;
    req.session.isAdmin = !!user.isAdmin;

    return res.json({ ok: true, user: { id: user.id, email: user.email, isAdmin: !!user.isAdmin } });
  } catch (e) {
    console.error("login error:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/me", requireAuth, (req, res) => {
  const u = req.user;
  return res.json({ user: { id: u.id, email: u.email, isAdmin: !!u.isAdmin } });
});

// ---------- data routes ----------
app.get("/api/articles", requireAuth, (req, res) => {
  const db = readData();
  // сортировка по дате публикации (DESC)
  db.items.sort((a, b) => (b.date || 0) - (a.date || 0));
  return res.json({ items: db.items, placementPrice: db.placementPrice || 0 });
});

app.post("/api/articles", requireAuth, async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url) return res.status(400).json({ error: "Url обязателен" });
    const id = extractIdFromUrl(url);
    if (!id) return res.status(400).json({ error: "Не удалось извлечь ID из ссылки" });

    const db = readData();
    if (db.items.some(x => Number(x.id) === Number(id))) {
      return res.status(200).json({ ok: true, duplicate: true });
    }

    const vc = await fetchVCContentById(id);
    const item = normalizeItemFromVC(vc);

    db.items.push(item);
    writeJSON(DATA_PATH, db);

    return res.json({ ok: true, item });
  } catch (e) {
    console.error("add article error:", e);
    return res.status(500).json({ error: e.message || "Ошибка добавления" });
  }
});

app.DELETE("/api/articles/:id", requireAuth, (req, res) => {
  const id = req.params.id;
  const db = readData();
  db.items = db.items.filter(x => String(x.id) !== String(id));
  writeJSON(DATA_PATH, db);
  return res.json({ ok: true });
});

app.patch("/api/articles/:id/refresh", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const db = readData();
    const idx = db.items.findIndex(x => Number(x.id) === id);
    if (idx < 0) return res.status(404).json({ error: "Не найдена" });

    const vc = await fetchVCContentById(id);
    const fresh = normalizeItemFromVC(vc);
    // сохраняем исходный url, если VC вернул другой (редирект)
    fresh.url = db.items[idx].url || fresh.url;

    db.items[idx] = fresh;
    writeJSON(DATA_PATH, db);
    return res.json({ ok: true, item: fresh });
  } catch (e) {
    console.error("refresh error:", e);
    return res.status(500).json({ error: e.message || "Ошибка обновления" });
  }
});

app.post("/api/refresh-all", requireAuth, async (req, res) => {
  try {
    const db = readData();
    for (let i = 0; i < db.items.length; i++) {
      const id = db.items[i].id;
      try {
        const vc = await fetchVCContentById(id);
        const fresh = normalizeItemFromVC(vc);
        fresh.url = db.items[i].url || fresh.url;
        db.items[i] = fresh;
      } catch (e) {
        console.error("refresh-all item", id, e.message);
      }
    }
    writeJSON(DATA_PATH, db);
    return res.json({ ok: true, count: db.items.length });
  } catch (e) {
    console.error("refresh-all error:", e);
    return res.status(500).json({ error: "Ошибка пакетного обновления" });
  }
});

app.post("/api/admin/set-price", requireAuth, requireAdmin, (req, res) => {
  const { price } = req.body || {};
  const db = readData();
  db.placementPrice = Number(price || 0);
  writeJSON(DATA_PATH, db);
  return res.json({ ok: true, placementPrice: db.placementPrice });
});

// ---------- fallback на главную ----------
app.get("/", (req, res) => {
  res.sendFile(path.join(ROOT, "public", "index.html"));
});

// ---------- error handler ----------
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return;
  res.status(500).json({ error: "Internal error" });
});

// ---------- запуск ----------
app.listen(PORT, () => {
  console.log(`Server on http://localhost:${PORT}`);
});
