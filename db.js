import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';

const db = new Database('data.sqlite');
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE,
  username TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin', -- 'admin' | 'user'
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vc_id INTEGER NOT NULL UNIQUE,
  url TEXT NOT NULL,
  title TEXT,
  pub_date INTEGER, -- unix (sec) от VC
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL,
  ts INTEGER NOT NULL,        -- ms since epoch
  views INTEGER,
  hits INTEGER,
  FOREIGN KEY(article_id) REFERENCES articles(id)
);
`);

function getSetting(key, def = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  return row ? row.value : def;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(key, String(value));
}

(function seed() {
  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (userCount === 0) {
    const hash = bcrypt.hashSync('admin', 12);
    db.prepare('INSERT INTO users(email,username,password_hash,role,is_active,created_at) VALUES(?,?,?,?,?,?)')
      .run('admin@localhost', 'admin', hash, 'admin', 1, Date.now());
  }
  if (getSetting('CPM_VIEWS') === null) setSetting('CPM_VIEWS', process.env.CPM_VIEWS ?? '0');
  if (getSetting('CPM_HITS') === null) setSetting('CPM_HITS', process.env.CPM_HITS ?? '0');
})();

export default db;
export { getSetting, setSetting };
