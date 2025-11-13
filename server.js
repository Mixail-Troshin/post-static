import 'dotenv/config';
import path from 'path';
import express from 'express';
import cookieParser from 'cookie-parser';
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import settingsRoutes from './routes/settingsRoutes.js';
import articleRoutes from './routes/articleRoutes.js';
import { requireAuth } from './auth.js';
import { startCron } from './cron.js';
import './db.js'; // ensure init

const app = express();
app.disable('x-powered-by');
app.use(cookieParser());

// статика
app.use(express.static(path.join(process.cwd(), 'public'), { extensions: ['html'] }));

// API
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/articles', articleRoutes);

// защищаем приложение (редирект на логин, если нет куки)
app.get('/app.html', requireAuth, (_req, res, next) => next());

// дефолт
app.get('/health', (_req, res) => res.json({ ok: true }));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`VC Metrics listening on :${port}`);
  startCron();
});
