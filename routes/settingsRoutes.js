import express from 'express';
import { requireAuth, requireAdmin } from '../auth.js';
import { getSetting, setSetting } from '../db.js';
import { toInt } from '../utils.js';

const router = express.Router();
router.use(requireAuth);

router.get('/', (_req, res) => {
  res.json({
    CPM_VIEWS: Number(getSetting('CPM_VIEWS', 0)),
    CPM_HITS: Number(getSetting('CPM_HITS', 0))
  });
});

router.put('/', requireAdmin, express.json(), (req, res) => {
  const { CPM_VIEWS, CPM_HITS } = req.body || {};
  setSetting('CPM_VIEWS', toInt(CPM_VIEWS, 0));
  setSetting('CPM_HITS', toInt(CPM_HITS, 0));
  res.json({ ok: true });
});

export default router;
