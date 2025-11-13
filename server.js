require('dotenv/config');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 5173;

// ---------- helpers: config load/save ----------
const CONFIG_PATH = path.resolve(__dirname, 'config.json');

function loadConfigSync() {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  return JSON.parse(raw);
}
async function saveConfig(cfg) {
  const tmp = CONFIG_PATH + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(cfg, null, 2));
  await fsp.rename(tmp, CONFIG_PATH);
}

// ---------- boot config ----------
let CONFIG = loadConfigSync();

// bootstrap admin (admin/admin) если нет пользователей
if (!Array.isArray(CONFIG.users)) CONFIG.users = [];
if (!CONFIG.users.length) {
  const hash = bcrypt.hashSync('admin', 10);
  CONFIG.users.push({
    id: 'u_admin',
    email: 'admin@local',
    username: 'admin',
    role: 'admin',
    passwordHash: hash,
    active: true,
    createdAt: new Date().toISOString()
  });
  saveConfig(CONFIG).catch(() => {});
}

// ---------- security ----------
const JWT_SECRET = CONFIG.auth?.jwtSecret || 'dev-secret-change-me';
const COOKIE_NAME = CONFIG.auth?.cookieName || 'vc_metrics_session';
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: false // на https можно поставить true
};

// ---------- middlewares ----------
app.use(express.json());
app.use(cookieParser());

// CORS (если надо дергать api из соседнего домена)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ---------- auth utils ----------
function signSession(user) {
  return jwt.sign(
    { uid: user.id, role: user.role, email: user.email, ts: Date.now() },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

function requireAuth(req, res, next) {
  const token = req.cookies[COOKIE_NAME];
  if (!token) return res.redirect('/login');
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = (CONFIG.users || []).find(u => u.id === payload.uid && u.active);
    if (!user) return res.redirect('/login');
    req.user = user;
    next();
  } catch {
    return res.redirect('/login');
  }
}

function requireApiAuth(req, res, next) {
  const token = req.cookies[COOKIE_NAME];
  if (!token) return res.status(401).json({ ok: false, error: 'unauthorized' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = (CONFIG.users || []).find(u => u.id === payload.uid && u.active);
    if (!user) return res.status(401).json({ ok: false, error: 'unauthorized' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }
  next();
}

// ---------- email ----------
function getTransport() {
  const s = CONFIG.smtp || {};
  if (!s.host) return null;
  return nodemailer.createTransport({
    host: s.host,
    port: Number(s.port || 587),
    secure: Boolean(s.secure || false),
    auth: s.user ? { user: s.user, pass: s.pass } : undefined
  });
}

async function sendMail(to, subject, html) {
  const t = getTransport();
  if (!t) {
    console.log('[EMAIL disabled] To:', to, 'Subject:', subject);
    console.log('--- html ---\n' + html + '\n-------------');
    return { simulated: true };
  }
  const from = CONFIG.smtp.from || CONFIG.smtp.user || 'no-reply@localhost';
  await t.sendMail({ from, to, subject, html });
  return { simulated: false };
}

// ---------- pages ----------
app.get('/login', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'login.html'));
});
app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'index.html'));
});

// ---------- static ----------
app.use('/public', express.static('public', { etag: true, maxAge: '1h' }));
app.use(express.static('public', { etag: true, maxAge: '1h' })); // css/js

// ---------- auth api ----------
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  const login = String(email || '').trim().toLowerCase();
  const pass = String(password || '');

  const user = (CONFIG.users || []).find(u =>
    (u.email && u.email.toLowerCase() === login) ||
    (u.username && u.username.toLowerCase() === login)
  );
  if (!user || !user.active) {
    return res.status(401).json({ ok: false, error: 'Неверные данные' });
  }
  const ok = await bcrypt.compare(pass, user.passwordHash || '');
  if (!ok) return res.status(401).json({ ok: false, error: 'Неверные данные' });

  const token = signSession(user);
  res.cookie(COOKIE_NAME, token, COOKIE_OPTS);
  res.json({ ok: true, user: { email: user.email, username: user.username, role: user.role } });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, COOKIE_OPTS);
  res.json({ ok: true });
});

app.get('/api/auth/me', requireApiAuth, (req, res) => {
  const u = req.user;
  res.json({ ok: true, user: { email: u.email, username: u.username, role: u.role } });
});

// ---------- users api (admin) ----------
app.get('/api/users', requireApiAuth, requireAdmin, (req, res) => {
  const list = (CONFIG.users || []).map(u => ({
    id: u.id,
    email: u.email,
    username: u.username,
    role: u.role,
    active: u.active,
    createdAt: u.createdAt
  }));
  res.json({ ok: true, items: list });
});

function randPassword(len = 10) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

app.post('/api/users/invite', requireApiAuth, requireAdmin, async (req, res) => {
  const { email } = req.body || {};
  const e = String(email || '').trim().toLowerCase();
  if (!e) return res.status(400).json({ ok: false, error: 'email пуст' });

  if ((CONFIG.users || []).some(u => u.email?.toLowerCase() === e)) {
    return res.status(409).json({ ok: false, error: 'Пользователь уже существует' });
  }
  const pwd = randPassword();
  const hash = await bcrypt.hash(pwd, 10);
  const user = {
    id: 'u_' + Date.now(),
    email: e,
    username: e,
    role: 'user',
    passwordHash: hash,
    active: true,
    createdAt: new Date().toISOString()
  };
  CONFIG.users.push(user);
  await saveConfig(CONFIG);

  const subject = 'Доступ в VC Metrics';
  const html = `<p>Вам предоставлен доступ.</p>
<p><b>Логин:</b> ${e}<br/><b>Пароль:</b> ${pwd}</p>
<p>URL: ${process.env.PUBLIC_URL || 'адрес вашего сервера'}</p>`;
  await sendMail(e, subject, html);

  res.json({ ok: true });
});

app.post('/api/users/reset', requireApiAuth, async (req, res) => {
  const { email } = req.body || {};
  const e = String(email || '').trim().toLowerCase();
  if (!e) return res.status(400).json({ ok: false, error: 'email пуст' });

  const user = (CONFIG.users || []).find(u => u.email?.toLowerCase() === e);
  if (!user || !user.active) return res.status(404).json({ ok: false, error: 'Нет такого пользователя' });

  // админ может всем, пользователь — только себе
  if (!(req.user.role === 'admin' || req.user.email?.toLowerCase() === e)) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }

  const pwd = randPassword();
  user.passwordHash = await bcrypt.hash(pwd, 10);
  await saveConfig(CONFIG);

  const subject = 'Сброс пароля VC Metrics';
  const html = `<p>Ваш пароль сброшен.</p>
<p><b>Логин:</b> ${e}<br/><b>Новый пароль:</b> ${pwd}</p>`;
  await sendMail(e, subject, html);

  res.json({ ok: true });
});

// ---------- vc metrics api (защищено) ----------
async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...options, signal: controller.signal });
    return r;
  } finally {
    clearTimeout(timer);
  }
}

app.get('/api/metrics', requireApiAuth, async (req, res) => {
  const id = String(req.query.content_id || '').trim();
  if (!id) return res.status(400).json({ ok: false, error: 'content_id обязателен' });

  const url = `https://api.vc.ru/v2.10/content?id=${encodeURIComponent(id)}&markdown=false`;
  const headers = {
    'accept': 'application/json',
    'origin': 'https://vc.ru',
    'referer': 'https://vc.ru'
  };
  try {
    const r = await fetchWithTimeout(url, { headers }, 8000);
    const text = await r.text();
    if (!r.ok) return res.status(r.status).json({ ok: false, error: `vc.ru ${r.status}`, body: text.slice(0, 1000) });

    const data = JSON.parse(text);
    const result = data?.result || {};
    const counters = result?.counters || {};
    res.json({
      ok: true,
      content_id: id,
      title: result?.title || null,
      url: result?.url || null,
      views: Number(counters.views ?? 0),
      hits: Number(counters.hits ?? result?.hitsCount ?? 0),
      comments: Number(counters.comments ?? 0),
      favorites: Number(counters.favorites ?? 0),
      reposts: Number(counters.reposts ?? 0),
      fetched_at: new Date().toISOString()
    });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message || String(e) });
  }
});

app.get('/api/bulk', requireApiAuth, async (req, res) => {
  const ids = String(req.query.ids || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  if (!ids.length) return res.status(400).json({ ok: false, error: 'ids пуст' });

  try {
    const items = await Promise.all(ids.map(async (id) => {
      try {
        const r = await fetch(`https://api.vc.ru/v2.10/content?id=${encodeURIComponent(id)}&markdown=false`, {
          headers: { 'accept': 'application/json', 'origin': 'https://vc.ru', 'referer': 'https://vc.ru' }
        });
        const data = await r.json();
        const result = data?.result || {};
        const counters = result?.counters || {};
        return {
          ok: true,
          content_id: id,
          title: result?.title || null,
          url: result?.url || null,
          views: Number(counters.views ?? 0),
          hits: Number(counters.hits ?? result?.hitsCount ?? 0)
        };
      } catch (e) {
        return { ok: false, content_id: id, error: e.message || String(e) };
      }
    }));
    res.json({ ok: true, items, fetched_at: new Date().toISOString() });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message || String(e) });
  }
});

app.listen(PORT, () => {
  console.log(`vc-metrics running on http://localhost:${PORT}`);
});
