import cron from 'node-cron';
import db from './db.js';
import { getContentById } from './vc.js';

export function startCron() {
  // ежедневно в 03:15 по Europe/Amsterdam
  cron.schedule('15 3 * * *', async () => {
    await refreshAll();
  }, { timezone: process.env.TZ || 'Europe/Amsterdam' });
}

export async function refreshAll() {
  const articles = db.prepare('SELECT id, vc_id FROM articles').all();
  const now = Date.now();
  for (const a of articles) {
    try {
      const data = await getContentById(a.vc_id);
      db.prepare('INSERT INTO metrics(article_id, ts, views, hits) VALUES(?,?,?,?)')
        .run(a.id, now, data.views ?? null, data.hits ?? null);
    } catch (e) {
      console.error('refresh error', a.vc_id, e.message);
    }
  }
}
