import express from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';
import nodemailer from 'nodemailer';

const router = express.Router();
router.use(requireAuth, requireAdmin);

router.get('/', (_req, res) => {
  const rows = db.prepare('SELECT id,email,username,role,is_active,created_at FROM users ORDER BY id DESC').all();
  res.json({ users: rows });
});

router.post('/', express.json(), async (req, res) => {
  const { email, role = 'user' } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email required' });
  const pwd = uuidv4().slice(0, 10);
  const hash = bcrypt.hashSync(pwd, 12);
  try {
    const info = db.prepare('INSERT INTO users(email,username,password_hash,role,is_active,created_at) VALUES(?,?,?,?,?,?)')
      .run(email, null, hash, role, 1, Date.now());

    const sent = await sendPassword(email, pwd);
    res.json({ ok: true, id: info.lastInsertRowid, emailed: sent });
  } catch (e) {
    if (String(e).includes('UNIQUE')) return res.status(409).json({ error: 'user exists' });
    res.status(500).json({ error: 'db error' });
  }
});

router.post('/:id/reset', async (req, res) => {
  const { id } = req.params;
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  if (!user) return res.status(404).json({ error: 'not found' });

  const pwd = uuidv4().slice(0, 10);
  const hash = bcrypt.hashSync(pwd, 12);
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash, id);

  const sent = await sendPassword(user.email || user.username, pwd);
  res.json({ ok: true, emailed: sent });
});

router.delete('/:id', (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM users WHERE id=?').run(id);
  res.json({ ok: true });
});

async function sendPassword(to, password) {
  if (!to) return false;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.log(`[EMAIL-OFF] Пароль для ${to}: ${password}`);
    return false;
  }
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST, port: Number(SMTP_PORT || 587), secure: false,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
  await transporter.sendMail({
    from: MAIL_FROM || SMTP_USER,
    to,
    subject: 'Доступ к VC Metrics',
    text: `Ваш пароль: ${password}`,
    html: `<p>Ваш пароль: <b>${password}</b></p>`
  });
  return true;
}

export default router;
