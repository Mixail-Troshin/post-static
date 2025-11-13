import express from 'express';
import session from 'express-session';
import cors from 'cors';
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- конфиг ---
const PORT = process.env.PORT || 3000;
const ADMIN_LOGIN = process.env.ADMIN_LOGIN || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'secret123';
const SESSION_SECRET = process.env.SESSION_SECRET || 'post-static-secret';
const ARTICLES_FILE = path.join(__dirname, 'articles.json');

// --- helpers для файла ---
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

  if (!res.ok) {
    throw new Error(`Ошибка загрузки страницы: ${res.status}`);
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  const title = $('h1').first().text().trim() || 'Без названия';

  // время публикации
  const timeEl = $('.content-header__date time').first();
  const publishedAt = timeEl.attr('datetime') || timeEl.text().trim() || null;

  // основной счётчик (тот, что возле иконки просмотра)
  const viewsText = $('.content-footer-button__label').first().text().trim();
  const views = Number(viewsText.replace(/\s/g, '')) || 0;

  return {
    title,
    publishedAt,
    opens: views // используем как "открытия страницы"
  };
}

// --- приложение ---
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 7 * 24 * 60 * 60 * 1000
    }
  })
);

// отдаём статику из public
app.use(express.static(path.join(__dirname, 'public')));

// --- middleware авторизации ---
function requireAuth(req, res, next) {
  if (req.session && req.session.auth) return next();
  return res.status(401).json({ error: 'Не авторизован' });
}

// --- Auth API ---
app.post('/api/login', (req, res) => {
  const { login, password } = req.body;

  if (login === ADMIN_LOGIN && password === ADMIN_PASSWORD) {
    req.session.auth = true;
    return res.json({ ok: true });
  }

  return res.status(401).json({ error: 'Неверный логин или пароль' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

// --- Articles API ---
// получить все статьи
app.get('/api/articles', requireAuth, async (req, res) => {
  const articles = await loadArticles();
  res.json(articles);
});

// добавить статью
app.post('/api/articles', requireAuth, async (req, res) => {
  try {
    const { url, cost } = req.body;

    if (!url || !url.startsWith('http')) {
      return res.status(400).json({ error: 'Неверная ссылка' });
    }

    const articles = await loadArticles();
    const stats = await fetchPostStats(url);

    const id = articles.length ? Math.max(...articles.map(a => a.id)) + 1 : 1;

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

    articles.push(article);
    await saveArticles(articles);

    res.json(article);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось добавить статью' });
  }
});

// удалить статью
app.delete('/api/articles/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const articles = await loadArticles();
  const filtered = articles.filter(a => a.id !== id);

  if (filtered.length === articles.length) {
    return res.status(404).json({ error: 'Статья не найдена' });
  }

  await saveArticles(filtered);
  res.json({ ok: true });
});

// SPA-фоллбек
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server started on http://localhost:${PORT}`);
});
