const express = require("express");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const app = express();
app.set("trust proxy", 1);

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const CONFIG_FILE = path.join(ROOT, "config.json");
const ARTICLES_FILE = path.join(ROOT, "articles.json");

// --- helpers -------------------------------------------------
async function readJSON(file, fallback) {
  try { return JSON.parse(await fsp.readFile(file, "utf8")); }
  catch { return fallback; }
}
async function writeJSON(file, data) {
  await fsp.writeFile(file, JSON.stringify(data, null, 2), "utf8");
}

// Инициализация конфигов, если их нет
async function ensureFiles() {
  const exists = p => fs.existsSync(p);
  if (!exists(CONFIG_FILE)) {
    await writeJSON(CONFIG_FILE, {
      placementPrice: 15000,
      users: [
        {
          email: "admin@local",
          // hash для пароля "admin" (bcrypt cost 12):
          passwordHash:
            "$2b$12$bF9/3pVaCM6L8BGZokmM8ecGfiY/WcKoIa/jv03gRrBTr2VQkVb2C",
          isAdmin: true
        }
      ]
    });
  }
  if (!exists(ARTICLES_FILE)) await writeJSON(ARTICLES_FILE, []);
}
const loadConfig = () => readJSON(CONFIG_FILE, { placementPrice: 0, users: [] });
const saveConfig = cfg => writeJSON(CONFIG_FILE, cfg);
const loadArticles = () => readJSON(ARTICLES_FILE, []);
const saveArticles = arr => writeJSON(ARTICLES_FILE, arr);

// очень простые сессии в памяти
const sessions = new Map();
function createSession(user) {
  const sid = crypto.randomUUID();
  sessions.set(sid, { user, exp: Date.now() + 7 * 24 * 3600e3 });
  return sid;
}
function readSession(req) {
  const sid = req.cookies?.sid;
  if (!sid) return null;
  const s = sessions.get(sid);
  if (!s) return null;
  if (Date.now() > s.exp) { sessions.delete(sid); return null; }
  return s.user;
}
function requireAuth(req, res, next) {
  const user = readSession(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  req.user = user;
  next();
}
function requireAdmin(req, res, next) {
  if (!req.user?.isAdmin) return res.status(403).json({ error: "Forbidden" });
  next();
}

// извлечение id публикации из URL VC
function extractIdFromUrl(url) {
  // берём последнюю группу из цифр
  const m = String(url).match(/(\d{5,})/g);
  if (!m || !m.length) return null;
  return Number(m[m.length - 1]);
}

// запрос метрик VC по id
async function fetchVcContent(id) {
  const u = `https://api.vc.ru/v2.10/content?id=${id}&markdown=false`;
  const r = await fetch(u, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`VC ${r.status}`);
  const j = await r.json();
  const res = j?.result;
  if (!res) throw new Error("invalid VC response");
  return {
    id: res.id,
    url: res.url || `https://vc.ru/${id}`,
    title: res.title || "",
    date: res.date || null,
    counters: {
      views: res.counters?.views ?? null, // показы в ленте
      hits: res.counters?.hits ?? null    // открытия статьи
    }
  };
}

// --- middleware & static ------------------------------------
app.use(express.json());
app.use(cookieParser());
app.use(express.static(PUBLIC, { extensions: ["html"] }));

// --- auth ----------------------------------------------------
app.get("/api/me", async (req, res) => {
  const user = readSession(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  res.json({ user: { email: user.email, isAdmin: !!user.isAdmin } });
});

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body || {};
  const cfg = await loadConfig();
  const user = cfg.users.find(u => u.email.toLowerCase() === String(email || "").toLowerCase());
  if (!user) return res.status(400).json({ error: "Неверные данные" });
  const ok = await bcrypt.compare(String(password || ""), user.passwordHash);
  if (!ok) return res.status(400).json({ error: "Неверные данные" });

  const sid = createSession({ email: user.email, isAdmin: !!user.isAdmin });
  res.cookie("sid", sid, {
    httpOnly: true,
    sameSite: "lax",
    secure: true, // на Render идёт по HTTPS
    maxAge: 7 * 24 * 3600 * 1000
  });
  res.json({ ok: true });
});

app.post("/api/logout", (req, res) => {
  const sid = req.cookies?.sid;
  if (sid) sessions.delete(sid);
  res.clearCookie("sid");
  res.json({ ok: true });
});

// --- articles ------------------------------------------------
app.get("/api/articles", requireAuth, async (req, res) => {
  const [items, cfg] = await Promise.all([loadArticles(), loadConfig()]);
  // сортировка по дате публикации (убыв.)
  items.sort((a, b) => (b.date || 0) - (a.date || 0));
  res.json({ items, placementPrice: cfg.placementPrice || 0 });
});

app.post("/api/articles", requireAuth, async (req, res) => {
  const url = String(req.body?.url || "").trim();
  const id = extractIdFromUrl(url);
  if (!id) return res.status(400).json({ error: "Не удалось извлечь ID из ссылки" });

  const items = await loadArticles();
  if (items.some(x => Number(x.id) === Number(id))) {
    return res.status(409).json({ error: "Такая статья уже добавлена" });
  }

  const meta = await fetchVcContent(id);
  const item = {
    ...meta,
    lastUpdated: Date.now()
  };
  items.push(item);
  await saveArticles(items);
  res.json({ item });
});

app.patch("/api/articles/:id/refresh", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const items = await loadArticles();
  const idx = items.findIndex(x => Number(x.id) === id);
  if (idx === -1) return res.status(404).json({ error: "Не найдено" });
  const meta = await fetchVcContent(id);
  items[idx] = { ...items[idx], ...meta, lastUpdated: Date.now() };
  await saveArticles(items);
  res.json({ item: items[idx] });
});

app.delete("/api/articles/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  let items = await loadArticles();
  const before = items.length;
  items = items.filter(x => Number(x.id) !== id);
  if (items.length === before) return res.status(404).json({ error: "Не найдено" });
  await saveArticles(items);
  res.json({ ok: true });
});

app.post("/api/refresh-all", requireAuth, async (req, res) => {
  const items = await loadArticles();
  const updated = [];
  for (let it of items) {
    try {
      const meta = await fetchVcContent(it.id);
      updated.push({ ...it, ...meta, lastUpdated: Date.now() });
    } catch {
      updated.push(it);
    }
  }
  await saveArticles(updated);
  res.json({ count: updated.length });
});

// --- admin ---------------------------------------------------
app.post("/api/admin/set-price", requireAuth, requireAdmin, async (req, res) => {
  const p = Number(req.body?.price || 0);
  if (isNaN(p) || p < 0) return res.status(400).json({ error: "Некорректная цена" });
  const cfg = await loadConfig();
  cfg.placementPrice = p;
  await saveConfig(cfg);
  res.json({ ok: true, placementPrice: p });
});

// --- fallback index ------------------------------------------
app.get("*", (req, res) => {
  const index = path.join(PUBLIC, "index.html");
  if (fs.existsSync(index)) return res.sendFile(index);
  res.status(500).type("text/plain").send("Missing public/index.html");
});

// --- start ---------------------------------------------------
ensureFiles().then(() => {
  app.listen(PORT, () => console.log(`VC Metrics running on :${PORT}`));
});
