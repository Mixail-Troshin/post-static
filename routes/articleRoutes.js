import express from 'express';
import db from '../db.js';
import { requireAuth } from '../auth.js';
import { extractVcIdFromUrl } from '../utils.js';
import { getContentById } from '../vc.js';

const router = express.Router();
router.use(requireAuth);

// список с аггрегатами
router.get('/', (_req, res) => {
  const cpmViews = Number(db.prepare("SELECT value FROM settings WHERE key='CPM_VIEWS'").get()?.value || 0);
  const cpmHits = Number(db.prepare("SELECT value FROM settings WHERE key='CPM_HITS'").get()?.value || 0);

  const rows = db.prepare(`
    SELECT a.id, a.vc_id, a.url, a.title, a.pub_date,
           (SELECT views FROM metrics m WHERE m.article_id=a.id ORDER BY ts DESC LIMIT 1) AS views,
           (SELECT hits  FROM metrics m WHERE m.article_id=a.id ORDER BY ts DESC LIMIT 1) AS hits
    FROM articles a
    ORDER BY a.pub_date DESC NULLS LAST, a.id DESC
  `).all();

  const data = rows.map(r => ({
    ...r,
    revenue_views: r.views ? Math.round((r.views / 1000) * cpmViews) : 0,
    revenue_hits:  r.hits  ? Math.round((r.hits  / 1000) * cpmHits)  : 0
  }));

  res.json({ items: data, cpm: { views: cpmViews, hits: cpmHits } });
});

// добавление по URL (дедуп по vc_id), моментальный первичный фетч
router.post('/', express.json(), async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url required' });
  const vcId = extractVcIdFromUrl(url);
  if (!vcId) return res.status(400).json({ error: 'cannot extract id' });

  const exists = db.prepare('SELECT id FROM articles WHERE vc_id=?').get(vcId);
  if (exists) return res.status(409).json({ error: 'article exists', vc_id: vcId });

  try {
    const data = await getContentById(vcId);
    const info = db.prepare('INSERT INTO articles(vc_id,url,title,pub_date,created_at) VALUES(?,?,?,?,?)')
      .run(vcId, url, data.title ?? '', data.pub_date_sec ?? null, Date.now());

    // первичный слепок метрик
    db.prepare('INSERT INTO metrics(article_id, ts, views, hits) VALUES(?,?,?,?)')
      .run(info.lastInsertRowid, Date.now(), data.views ?? null, data.hits ?? null);

    res.json({ ok: true, id: info.lastInsertRowid, vc_id: vcId, title: data.title, pub_date: data.pub_date_sec });
  } catch (e) {
    res.status(502).json({ error: 'vc fetch failed', details: e.message });
  }
});

router.delete('/:id', (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM metrics WHERE article_id=?').run(id);
  db.prepare('DELETE FROM articles WHERE id=?').run(id);
  res.json({ ok: true });
});

// ручной рефреш конкретной статьи
router.post('/:id/refresh', async (req, res) => {
  const { id } = req.params;
  const art = db.prepare('SELECT * FROM articles WHERE id=?').get(id);
  if (!art) return res.status(404).json({ error: 'not found' });

  try {
    const data = await getContentById(art.vc_id);
    db.prepare('INSERT INTO metrics(article_id, ts, views, hits) VALUES(?,?,?,?)')
      .run(art.id, Date.now(), data.views ?? null, data.hits ?? null);
    res.json({ ok: true, views: data.views, hits: data.hits });
  } catch (e) {
    res.status(502).json({ error: 'vc fetch failed', details: e.message });
  }
});

// таймсерия для графика
router.get('/:id/metrics', (req, res) => {
  const { id } = req.params;
  const points = db.prepare('SELECT ts, views, hits FROM metrics WHERE article_id=? ORDER BY ts ASC').all(id);
  res.json({ points });
});

export default router;
