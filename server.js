import express from 'express';
import session from 'express-session';
import cors from 'cors';
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import FileStoreFactory from 'session-file-store';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const FileStore = FileStoreFactory(session);

// --- paths ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- load config (без ENV, всё из репозитория) ---
const DEFAULTS = {
  port: 3000,
  adminLogin: 'admin',
  adminPassword: 'secret123',
  sessionSecret: 'post-static-secret',
  dataDir: path.join(__dirname, 'data')
};

let CONFIG = { ...DEFAULTS };
try {
  const cfg = await fs.readFile(path.join(__dirname, 'config.json'), 'utf-8');
  const u = JSON.parse(cfg);
  CONFIG = { ...CONFIG, ...u, dataDir: path.resolve(__dirname, u.dataDir || DEFAULTS.dataDir) };
} catch {
  // оставим дефолт
}

// --- ensure data dirs/files ---
await fs.mkdir(CONFIG.dataDir, { recursive: true });
await fs.mkdir(path.join(CONFIG.dataDir, 'sessions'), { recursive: true });

const LEGACY_ARTICLES = path.join(__dirname, 'articles.json'); // если раньше лежал в корне
const ARTICLES_FILE = path.join(CONFIG.dataDir, 'articles.json');

try {
  await fs.access(ARTICLES_FILE);
} catch {
  try {
    const legacy = await fs.readFile(LEGACY_ARTICLES, 'utf-8');
    await fs.writeFile(ARTICLES_FILE, legacy, 'utf-8');
  } catch {
    await fs.writeFile(ARTICLES_FILE, '[]', 'utf-8');
  }
}

// --- helpers ---
async function loadArticles() {
  try {
    const data = await fs.readFile(ARTICLES_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}
async function saveArticles(list) {
  await fs.writeFile(ARTICLES_FILE, JSON.stringify(list, null, 2), 'utf-8');
}

// --- VC.ru parser ---
async function fetchPostStats(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119 Safari/537.36'
    }
  });
  if (!res.ok) throw new Error(`Ошибка загрузки: ${res.status}`);

  const html = await res.text();
  const $ = cheerio.load(html);

  const title = $('h1').first().text().trim() || 'Без названия';

  const timeEl = $('.content-header__date time').first();
  const publishedAt = timeEl.attr('datetime') || timeEl.text().trim() || null;

  // На видимой странице есть счётчик рядом с глазом:
  const viewsText = $('.content-footer-button__label').first().text().trim();
  const opens = Number(viewsText.replace(/\s/g, '')) || 0;

  return { title, publishedAt, opens };
}

// --- app ---
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// sessions (file store -> без MemoryStore warning)
app.use(
  session({
    store: new FileStore({
      path: path.join(CONFIG.dataDir, 'sessions'),
      retries: 1,
      fileExtension: '.json'
    }),
    secret: CONFIG.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: 'lax',
      secure: false // под HTTPS можно true + app.set('trust proxy', 1)
    }
  })
);

// --- STATIC under /static (железно не ломается fallback'ом) ---
const publicDir = path.join(__dirname, 'public');
app.use(
  '/static',
  express.static(publicDir, {
    maxAge: '1h',
    etag: true,
    lastModified: true
  })
);

// --- auth middleware ---
function requireAuth(req, res, next) {
  if (req.session && req.session.auth) return next();
  return res.status(401).json({ error: 'Не авторизован' });
}

// --- auth routes ---
app.post('/api/login', (req, res) => {
  const { login, password } = req.body;
  if (login === CONFIG.adminLogin && password === CONFIG.adminPassword) {
    req.session.auth = true;
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: 'Неверный логин или пароль' });
});
app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// --- articles API ---
app.get('/api/articles', requireAuth, async (_req, res) => {
  res.json(await loadArticles());
});

app.post('/api/articles', requireAuth, async (req, res) => {
  try {
    const { url, cost } = req.body;
    if (!url || !url.startsWith('http')) {
      return res.status(400).json({ error: 'Неверная ссылка' });
    }

    const list = await loadArticles();
    const stats = await fetchPostStats(url);

    const id = list.length ? Math.max(...list.map(a => a.id)) + 1 : 1;
    const costNum = Number(cost) || 0;
    const opens = stats.opens || 0;
    const cpm = opens > 0 ? Math.round((costNum / opens) * 1000) : null;

    const article = {
      id,
      url,
      title: stats.title,
      publishedAt: stats.publishedAt,
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

// --- SPA entry for roots ---
app.get(['/', '/post-static'], (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// --- SPA fallback (самый конец):
// не трогаем /api, /static и запросы на файлы с точкой (*.css, *.js, *.ico, ...)
app.get(/^\/(post-static\/)?(?!api\/)(?!static\/)(?!.*\..*$).*/, (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// --- start ---
const PORT = Number(process.env.PORT) || CONFIG.port || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server started on http://localhost:${PORT}`);
});
