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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- конфиг ---
const PORT = process.env.PORT || 3000;
const ADMIN_LOGIN = process.env.ADMIN_LOGIN || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'secret123';
const SESSION_SECRET = process.env.SESSION_SECRET || 'post-static-secret';

// путь к файлу статей: по умолчанию в корне проекта, но можно вынести на диск /data
const ARTICLES_FILE = process.env.ARTICLES_FILE || path.join(__dirname, 'articles.json');

// --- helpers файла статей ---
async function loadArticles() {
  try {
    const data = await fs.readFile(ARTICLES_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function saveArticles(articles) {
  await fs.writeFile(ARTICLES_FILE, JSON.stringify(articles, null, 2), 'utf-8');
}

// --- парсинг VC.ru ---
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

  // дата публикации
  const timeEl = $('.content-header__date time').first();
  const publishedAt = timeEl.attr('datetime') || timeEl.text().trim() || null;

  // доступный на странице счётчик (берём как "открытия")
  const viewsText = $('.content-footer-button__label').first().text().trim();
  const opens = Number(viewsText.replace(/\s/g, '')) || 0;

  return { title, publishedAt, opens };
}

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// === СЕССИИ (файловый стор, чтобы не было предупреждений и чтобы переживать рестарты) ===
app.use(
  session({
    store: new FileStore({
      path: process.env.SESSION_DIR || '/data/sessions',
      retries: 1,
      fileExtension: '.json'
    }),
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: 'lax',
      secure: false // на https можно поставить true + app.set('trust proxy', 1)
    }
  })
);

// === СТАТИКА: СТАВИМ ДО РОУТОВ И Fallback ===
const publicDir = path.join(__dirname, 'public');

// в корне
app.use(express.static(publicDir));
// и под префиксом /post-static (если открываешь по такому пути)
app.use('/post-static', express.static(publicDir));

// --- middleware авторизации ---
function requireAuth(req, res, next) {
  if (req.session && req.session.auth) return next();
  return res.status(401).json({ error: 'Не авторизован' });
}

// --- AUTH API ---
app.post('/api/login', (req, res) => {
  const { login, password } = req.body;
  if (login === ADMIN_LOGIN && password === ADMIN_PASSWORD) {
    req.session.auth = true;
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: 'Неверный логин или пароль' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// --- ARTICLES API ---
app.get('/api/articles', requireAuth, async (_req, res) => {
  const articles = await loadArticles();
  res.json(articles);
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

// === SPA Fallback: САМЫЙ КОНЕЦ ===
// отдаём index.html и по корню, и по /post-static
app.get(['/', '/post-static', '/post-static/*'], (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// health-check (опционально для Render)
app.get('/health', (_req, res) => res.send('ok'));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server started on http://localhost:${PORT}`);
});
