import express from 'express';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { findUserByLogin, setAuthCookie, clearAuthCookie } from '../auth.js';

const router = express.Router();

router.post('/login', express.json(), (req, res) => {
  const { login, password } = req.body || {};
  if (!login || !password) return res.status(400).json({ error: 'login and password required' });
  const user = findUserByLogin(login);
  if (!user || !user.is_active) return res.status(401).json({ error: 'invalid credentials' });
  if (!bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: 'invalid credentials' });

  setAuthCookie(res, { uid: user.id, role: user.role, login: user.email || user.username });
  res.json({ ok: true });
});

router.post('/logout', (_req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  // если нужно — можно проверять куку прямо тут; роут оставляем публичным: фронт просто увидит 401
  res.status(401).json({ error: 'unauthorized' });
});

export default router;
