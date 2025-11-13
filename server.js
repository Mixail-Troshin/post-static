import express from 'express';
import session from 'express-session';
import cors from 'cors';
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import FileStoreFactory from 'session-file-store';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

process.on('unhandledRejection', e => console.error('UNHANDLED REJECTION:', e));
process.on('uncaughtException', e => console.error('UNCAUGHT EXCEPTION:', e));

const FileStore = FileStoreFactory(session);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');

// ---- config ----
const DEFAULTS = {
  port: 3000,
  adminLogin: 'admin',
  adminPassword: 'secret123',
  sessionSecret: 'post-static-secret',
  dataDir: path.join(__dirname, 'data')
};
let CONFIG = { ...DEFAULTS };
try {
  const raw = await fs.readFile(path.join(__dirname, 'config.json'), 'utf-8');
  const userCfg = JSON.parse(raw);
  CONFIG = { ...CONFIG, ...userCfg, dataDir: path.resolve(__dirname, userCfg.dataDir || DEFAULTS.dataDir) };
} catch {}

// ---- storage prep (fallback в /tmp на Render) ----
async function ensureWritableDir(dir) {
  try {
    await fs.mkdir(dir, { recursive: true });
    const probe = path.join(dir, '.write-test');
    await fs.writeFile(probe, 'ok');
    await fs.unlink(probe);
    return true;
  } catch {
    return false;
  }
}
await fs.mkdir(CONFIG.dataDir, { recursive: true });

let SESSIONS_DIR = path.join(CONFIG.dataDir, 'sessions');
if (!(await ensureWritableDir(SESSIONS_DIR))) {
  SESSIONS_DIR = '/tmp/post-static-sessions';
  await fs.mkdir(SESSIONS_DIR, { recursive: true });
}

const ARTICLES_FILE = path.join(CONFIG.dataDir, 'articles.json');
try { await fs.access(ARTICLES_FILE); }
catch { await fs.writeFile(ARTICLES_FILE, '[]', 'utf-8'); }

async function loadArticles() {
  try { return JSON.parse(await fs.readFile(ARTICLES_FILE, 'utf-8')); }
  catch { return []; }
}
async function saveArticles(list) {
  await fs.writeFile(ARTICLES_FILE, JSON.stringify(list, null, 2), 'utf-8');
}

// ---- VC.ru parser ----
async function fetchPostStats(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119 Safari/537.36'
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const title = $('h1').first().text().trim() || 'Без названия';
  const timeEl = $('.content-header__date time').first();
  const publishedAt = timeEl.attr('datetime') || timeEl.text().trim() || null;

  // используем видимый счётчик «открытий» рядом с глазом
  const viewsText = $('.content-footer-button__label').first().text().trim();
  const opens = Number(viewsText.replace(/\s/g, '')) || 0;

  return { title, publishedAt, opens };
}

// ---- app ----
const app = express();
app.set('trust proxy', 1);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    name: 'psid',
    store: new FileStore({
      path: SESSIONS_DIR,
      retries: 1,
      fileExtension: '.json'
    }),
    secret: CONFIG.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      // по умолчанию — только до закрытия браузера
      sameSite: 'lax',
      secure: false
    }
  })
);

// ---- static (/static) ----
app.use('/static', express.static(publicDir, {
  maxAge: '1h',
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.css')) res.setHeader('Content-Type', 'text/css; charset=utf-8');
    if (filePath.endsWith('.js'))  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  }
}));
// предохранители
app.get('/static/styles.css', (req, res) => {
  res.type('text/css');
  res.sendFile(path.join(publicDir, 'styles.css'));
});
app.get('/static/app.js', (req, res) => {
  res.type('application/javascript');
  res.sendFile(path.join(publicDir, 'app.js'));
});

// ---- auth ----
function requireAuth(req, res, next) {
  if (req.session && req.session.auth) return next();
  return res.status(401).json({ error: 'Не авторизован' });
}

app.get('/api/me', (req, res) => {
  res.json({ auth: !!(req.session && req.session.auth) });
});

app.post('/api/login', (req, res) => {
  const { login, password, remember } = req.body || {};
  if (login === CONFIG.adminLogin && password === CONFIG.adminPassword) {
    req.session.regenerate(err => {
      if (err) return res.status(500).json({ error: 'Ошибка сессии' });
      req.session.auth = true;
      if (remember) {
        req.session.cookie.maxAge = 7 * 24 * 60 * 60 * 1000; // 7 дней
      } else {
        delete req.session.cookie.maxAge;
        req.session.cookie.expires = false;
      }
      return res.json({ ok: true });
    });
  } else {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('psid');
    res.json({ ok: true });
  });
});

// ---- API: articles ----
app.get('/api/articles', requireAuth, async (_req, res) => {
  res.json(await loadArticles());
});

app.post('/api/articles', requireAuth, async (req, res) => {
  try {
    const { url, cost } = req.body || {};
    if (!url || !/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: 'Неверная ссылка' });
    }
    const list = await loadArticles();
    const stats = await fetchPostStats(url);

    const id = list.length ? Math.max(...list.map(a => a.id)) + 1 : 1;
    const costNum = Number(cost) || 0;
    const opens = stats.opens || 0;
    const cpm = opens > 0 ? Math.round((costNum / opens) * 1000) : null;

    const nowIso = new Date().toISOString();
    const article = {
      id,
      url,
      title: stats.title,
      publishedAt: stats.publishedAt, // дата публикации
      updatedAt: nowIso,              // дата последнего обновления
      opens,
      cost: costNum,
      cpm
    };

    list.push(article);
    await saveArticles(list);
    res.json(article);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Не удалось добавить статью' });
  }
});

// ручное обновление одной статьи (перетянуть свежие цифры и updatedAt)
app.post('/api/articles/:id/refresh', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const list = await loadArticles();
  const idx = list.findIndex(a => a.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Статья не найдена' });

  try {
    const stats = await fetchPostStats(list[idx].url);
    const opens = stats.opens || 0;
    const cost = Number(list[idx].cost) || 0;
    list[idx] = {
      ...list[idx],
      title: stats.title || list[idx].title,
      publishedAt: stats.publishedAt || list[idx].publishedAt,
      opens,
      cpm: opens > 0 ? Math.round((cost / opens) * 1000) : null,
      updatedAt: new Date().toISOString()
    };
    await saveArticles(list);
    return res.json(list[idx]);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Не удалось обновить' });
  }
});

app.delete('/api/articles/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const list = await loadArticles();
  const next = list.filter(a => a.id !== id);
  if (next.length === list.length) return res.status(404).json({ error: 'Статья не найдена' });
  await saveArticles(next);
  res.json({ ok: true });
});

// health
app.get('/health', (_req, res) => res.send('ok'));

// SPA entry
app.get(['/', '/post-static'], (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(publicDir, 'index.html'));
});

// SPA fallback (в самом конце!)
app.get(/^\/(post-static\/)?(?!api\/)(?!static\/)(?!.*\..*$).*/, (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(publicDir, 'index.html'));
});

const PORT = Number(process.env.PORT) || CONFIG.port || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server started on http://localhost:${PORT}`);
  console.log(`publicDir = ${publicDir}`);
});
