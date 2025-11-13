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

// ======================================================
// Загрузка / сохранение JSON
// ======================================================

function loadArticles() {
  if (!fs.existsSync(ARTICLES_FILE)) {
    fs.writeFileSync(ARTICLES_FILE, '[]', 'utf8');
  }
  return JSON.parse(fs.readFileSync(ARTICLES_FILE, 'utf8'));
}

function saveArticles(data) {
  fs.writeFileSync(ARTICLES_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// ======================================================
// ПАРСИНГ СТАТЬИ VC.RU
// ======================================================

async function fetchArticleInfo(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    }
  });

  const html = await response.text();
  const $ = cheerio.load(html);

  // ---------- Заголовок ----------
  const title =
    $('meta[property="og:title"]').attr('content') ||
    $('h1').first().text().trim() ||
    'Без названия';

  // ---------- Дата ----------
  const timeEl = $('.content-header__date time').first();

  const publishedDatetime = timeEl.attr('datetime') || '';
  const publishedTitle = timeEl.attr('title') || timeEl.text().trim() || '';

  const publishedAt = publishedTitle || publishedDatetime || '';

  // ---------- Просмотры ----------
  let viewsText = $('.content-footer-button__label').first().text().trim();
  let views = parseInt(viewsText.replace(/\D/g, ''), 10);
  if (isNaN(views)) views = 0;

  return {
    title,
    publishedAt,
    publishedDatetime,
    views
  };
}

// ======================================================
// EXPRESS API
// ======================================================

app.use(cors());
app.use(express.json());

// Получить список
app.get('/api/articles', (req, res) => {
  res.json(loadArticles());
});

// Добавить статью
app.post('/api/articles', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "URL is required" });

  const articles = loadArticles();

  if (articles.find(a => a.url === url)) {
    return res.status(400).json({ error: "Статья уже есть в списке" });
  }

  try {
    const info = await fetchArticleInfo(url);

    const newItem = {
      id: Date.now().toString(),
      url,
      title: info.title,
      publishedAt: info.publishedAt,
      publishedDatetime: info.publishedDatetime,
      views: info.views,
      lastUpdated: new Date().toISOString()
    };

    articles.push(newItem);
    saveArticles(articles);

    res.json(newItem);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка загрузки статьи" });
  }
});

// Обновить одну
app.post('/api/articles/:id/refresh', async (req, res) => {
  const articles = loadArticles();
  const article = articles.find(a => a.id === req.params.id);

  if (!article) return res.status(404).json({ error: "Not found" });

  try {
    const info = await fetchArticleInfo(article.url);

    article.title = info.title;
    article.publishedAt = info.publishedAt;
    article.publishedDatetime = info.publishedDatetime;
    article.views = info.views;
    article.lastUpdated = new Date().toISOString();

    saveArticles(articles);
    res.json(article);
  } catch (err) {
    res.status(500).json({ error: "Ошибка обновления" });
  }
});

// Обновить все
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
    } catch (err) {
      console.error("Ошибка при обновлении:", article.url);
    }
  }

  saveArticles(articles);
  res.json({ updated, total: articles.length });
});

// ======================================================
// CRON — ежедневное обновление
// ======================================================

cron.schedule("0 3 * * *", () => {
  console.log("Daily refresh started");
  const articles = loadArticles();

  articles.forEach(async (article) => {
    try {
      const info = await fetchArticleInfo(article.url);
      article.title = info.title;
      article.publishedAt = info.publishedAt;
      article.views = info.views;
      article.lastUpdated = new Date().toISOString();
    } catch (err) {
      console.log("Error refreshing:", article.url);
    }
  });

  saveArticles(articles);
  console.log("Daily refresh completed");
});

// ======================================================
// START SERVER
// ======================================================

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
