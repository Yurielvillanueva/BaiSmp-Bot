const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { logger } = require('../logger');

let db;

function getDb(databasePath) {
  if (db) return db;
  const resolved = path.resolve(databasePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  db = new Database(resolved);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

function migrate(databasePath) {
  const conn = getDb(databasePath);
  conn.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const dir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const applied = new Set(conn.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name));
  const insert = conn.prepare('INSERT INTO schema_migrations (name) VALUES (?)');
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const tx = conn.transaction(() => {
      conn.exec(sql);
      insert.run(file);
    });
    tx();
    logger.info({ file }, 'applied migration');
  }
  return conn;
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

if (require.main === module) {
  require('dotenv').config();
  migrate(process.env.DATABASE_PATH || './data/bridge.sqlite');
}

module.exports = { getDb, migrate, closeDb };
