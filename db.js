const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'database.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  // Applications Table
  db.run(`
    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      secret TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Keys Table (Licenses)
  db.run(`
    CREATE TABLE IF NOT EXISTS keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key_string TEXT NOT NULL UNIQUE,
      app_id INTEGER,
      duration_days INTEGER,
      duration_unit TEXT DEFAULT 'days',
      status TEXT DEFAULT 'unused', -- 'unused', 'active', 'banned'
      hwid TEXT DEFAULT NULL,
      expires_at DATETIME DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_used_at DATETIME DEFAULT NULL,
      note TEXT,
      FOREIGN KEY (app_id) REFERENCES applications (id) ON DELETE CASCADE
    )
  `);

  // Add duration_unit column to existing databases (safe, ignores error if already exists)
  db.run(`ALTER TABLE keys ADD COLUMN duration_unit TEXT DEFAULT 'days'`, () => {});

  // Remote Variables Table
  db.run(`
    CREATE TABLE IF NOT EXISTS variables (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id INTEGER,
      name TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(app_id, name),
      FOREIGN KEY (app_id) REFERENCES applications (id) ON DELETE CASCADE
    )
  `);

  // Logs Table
  db.run(`
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id INTEGER,
      key_string TEXT,
      action TEXT NOT NULL,
      ip_address TEXT,
      hwid TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (app_id) REFERENCES applications (id) ON DELETE CASCADE
    )
  `);
});

// Promise wrappers
const query = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

const get = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

const run = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
};

module.exports = {
  db,
  query,
  get,
  run
};
