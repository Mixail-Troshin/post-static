import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import cron from 'node-cron';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const ARTICLES_FILE = path.join(__dirname, 'articles.json');

// =======================
// Загрузка / сохранение
// =======================

function loadArticles() {
  if (!fs.existsSync(ARTICLES_FILE)) {
    fs.writeFileSync(ARTICLES_FILE, '[]', 'utf8');
  }
  const raw = fs.readFileSync(ARTICLES_FILE, 'utf8');
  try {
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error('Ошибка парсинга articles.json, перезаписываю []', e);
    fs.writeFileSync(ARTICLES_FILE, '[]', 'utf8');
    return [];
  }
}

function saveArticles(articles) {
  fs.writeFileSync(ARTICLES_FILE, JSON.stringify(articles, null, 2), 'utf8');
}

// =======================
// Парсинг статьи vc.ru
// =======================

async function fetchArticleInfo(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    }
  });

  if (!res.ok) {
    throw new Error(`Failed to load page: ${res.status} ${res.statusText}`);
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  // ---- Заголовок ----
  const title =
    $('meta[property="og:title"]').attr('content') ||
    $('h1').first().text().trim() ||
    'Без названия';

  // ---- Дата ----
  const timeEl = $('.content-header__date time').first();
  const publishedDatetime = timeEl.attr('datetime') || '';
  const publishedTitle = timeEl.attr('title') || timeEl.text().trim() || '';
  const publishedAt = publishedTitle || publishedDatetime || '';

  // ---- Открытия страницы поста ----
  let opens = 0;

  // 1) Пробуем вытащить из блока модалки (если он есть в HTML)
  try {
    $('.post-stats__item').each((_, el) => {
      const label = $(el).find('.post-stats__label').text().trim().toLowerCase();
      if (label.includes('открытий страницы поста') || label === 'открытий') {
        const valueText = $(el).find('.post-stats__value').text().trim();
        const val = parseInt(valueText.replace(/[^\d]/g, ''), 10);
        if (!Number.isNaN(val)) {
          opens = val;
        }
      }
    });
  } catch (e) {
    console.warn('Не удалось разобрать post-stats__item', e);
  }

  // 2) Если не нашли в модалке — пробуем JSON counters.views
  if (!opens || Number.isNaN(opens)) {
    try {
      const countersMatch = html.match(
        /"counters"\s*:\s*\{[^}]*"views"\s*:\s*(\d+)/m
      );
      if (countersMatch && countersMatch[1]) {
        opens = parseInt(countersMatch[1], 10);
      }
    } catch (e) {
      console.warn('Не удалось извлечь counters.views из HTML', e);
    }
  }

  // 3) Fallback — .content-footer-button__label
  if (!opens || Number.isNaN(opens)) {
    let viewsText = $('.content-footer-button__label').first().text().trim();
    const candidate = parseInt(viewsText.replace(/[^\d]/g, ''), 10);
    if (!Number.isNaN(candidate)) {
      opens = candidate;
    } else {
      opens = 0;
    }
  }

  return {
    title,
    publishedAt,
    publishedDatetime,
    views: opens // views = "открытий страницы поста"
  };
}

// =======================
// Миддлвары + статика
// =======================

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// =======================
// API
// =======================

// Получить все статьи
app.get('/api/articles', (req, res) => {
  const articles = loadArticles();
  res.json(articles);
});

// Добавить новую статью
app.post('/api/articles', async (req, res) => {
  const { url } = req.body;
  let { cost } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'url is required' });
  }

  // приводим cost к числу
  if (typeof cost === 'string') {
    cost = parseFloat(cost.replace(',', '.'));
  }
  if (typeof cost !== 'number' || Number.isNaN(cost)) {
    cost = null;
  }

  try {
    const articles = loadArticles();

    if (articles.find((a) => a.url === url)) {
      return res.status(400).json({ error: 'Эта статья уже есть в списке' });
    }

    const info = await fetchArticleInfo(url);

    const newArticle = {
      id: Date.now().toString(),
      url,
      title: info.title,
      publishedAt: info.publishedAt,
      publishedDatetime: info.publishedDatetime,
      views: info.views,
      cost, // стоимость размещения (руб), может быть null
      lastUpdated: new Date().toISOString()
    };

    articles.push(newArticle);
    saveArticles(articles);

    res.json(newArticle);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Не удалось получить данные статьи' });
  }
});

// Обновить одну статью
app.post('/api/articles/:id/refresh', async (req, res) => {
  const { id } = req.params;
  const articles = loadArticles();
  const article = articles.find((a) => a.id === id);

  if (!article) {
    return res.status(404).json({ error: 'Статья не найдена' });
  }

  try {
    const info = await fetchArticleInfo(article.url);

    article.title = info.title;
    article.publishedAt = info.publishedAt;
    article.publishedDatetime = info.publishedDatetime;
    article.views = info.views;
    article.lastUpdated = new Date().toISOString();
    // cost НЕ трогаем

    saveArticles(articles);
    res.json(article);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Не удалось обновить статью' });
  }
});

// Обновить все статьи
app.post('/api/refresh-all', async (req, res) => {
  const articles = loadArticles();
  let updated = 0;

  for (const article of articles) {
    try {
      const info = await fetchArticleInfo(article.url);

      article.title = info.title;
      article.publishedAt = info.publishedAt;
      article.publishedDatetime = info.publishedDatetime;
      article.views = info.views;
      article.lastUpdated = new Date().toISOString();
      // cost не трогаем

      updated++;
    } catch (e) {
      console.error(`Failed to refresh ${article.url}`, e);
    }
  }

  saveArticles(articles);
  res.json({ updated, total: articles.length });
});

// Удалить статью
app.delete('/api/articles/:id', (req, res) => {
  const { id } = req.params;
  const articles = loadArticles();
  const index = articles.findIndex((a) => a.id === id);

  if (index === -1) {
    return res.status(404).json({ error: 'Статья не найдена' });
  }

  const deleted = articles.splice(index, 1)[0];
  saveArticles(articles);
  res.json({ success: true, deleted });
});

// =======================
// CRON — ежедневное обновление
// =======================

cron.schedule('0 3 * * *', async () => {
  console.log('Running daily refresh job...');
  const articles = loadArticles();

  for (const article of articles) {
    try {
      const info = await fetchArticleInfo(article.url);
      article.title = info.title;
      article.publishedAt = info.publishedAt;
      article.publishedDatetime = info.publishedDatetime;
      article.views = info.views;
      article.lastUpdated = new Date().toISOString();
    } catch (e) {
      console.error(`Failed to refresh ${article.url}`, e);
    }
  }

  saveArticles(articles);
  console.log('Daily refresh finished');
});

// =======================
// Старт сервера
// =======================

app.listen(PORT, () => {
  console.log(`Server started on http://localhost:${PORT}`);
});
