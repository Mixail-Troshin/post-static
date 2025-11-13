import jwt from 'jsonwebtoken';
import db from './db.js';

const COOKIE_NAME = 'token';

export function signToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '30d' });
}

export function requireAuth(req, res, next) {
  try {
    const token = req.cookies[COOKIE_NAME];
    if (!token) return res.status(401).json({ error: 'unauthorized' });
    const data = jwt.verify(token, process.env.JWT_SECRET);
    req.user = data;
    next();
  } catch {
    return res.status(401).json({ error: 'unauthorized' });
  }
}

export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  next();
}

export function setAuthCookie(res, payload) {
  const token = signToken(payload);
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false, // поставь true за CDN/HTTPS
    maxAge: 1000 * 60 * 60 * 24 * 30
  });
}

export function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

export function findUserByLogin(login) {
  return db.prepare('SELECT * FROM users WHERE email=? OR username=?').get(login, login);
}
