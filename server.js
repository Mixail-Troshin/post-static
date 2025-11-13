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

// ====== путь к файлу с данными ======
const ARTICLES_FILE = path.join(__dirname, 'articles.json');

// ====== helpers для сохранения/загрузки ======

function loadArticles() {
  if (!fs.existsSync(ARTICLES_FILE)) {
    fs.writeFileSync(ARTICLES_FILE, '[]', 'utf8');
  }
  const raw = fs.readFileSync(ARTICLES_FILE, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error('Failed to parse articles.json, resetting file', e);
    fs.writeFileSync(ARTICLES_FILE, '[]', 'utf8');
    return [];
  }
}

function saveArticles(articles) {
  fs.writeFileSync(ARTICLES_FILE, JSON.stringify(articles, null, 2), 'utf8');
}

// ====== парсинг vc.ru ======

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

  // ---- Просмотры ----
  let viewsText = $('.content-footer-button__label').first().text().trim();
  let views = parseInt(viewsText.replace(/[^\d]/g, ''), 10);
  if (Number.isNaN(views)) views = 0;

  return {
    title,
    publishedAt,
    publishedDatetime,
    views
  };
}

// ====== миддлвары ======

app.use(cors());
app.use(express.json());

// раздаём статику из папки public — тут будет наш HTML, JS, CSS
app.use(express.static(path.join(__dirname, 'public')));

// ====== API ======

// получить список статей
app.get('/api/articles', (req, res) => {
  const articles = loadArticles();
  res.json(articles);
});

// добавить новую статью
app.post('/api/articles', async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'url is required' });
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

// обновить одну
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

    saveArticles(articles);
    res.json(article);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Не удалось обновить статью' });
  }
});

// обновить все
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
      updated++;
    } catch (e) {
      console.error(`Failed to refresh ${article.url}`, e);
    }
  }

  saveArticles(articles);
  res.json({ updated, total: articles.length });
});

// ====== CRON: ежедневное обновление ======

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

// ====== старт ======

app.listen(PORT, () => {
  console.log(`Server started on http://localhost:${PORT}`);
});
