const fs = require('fs');
const path = require('path');

// Determine path: use /tmp/db.json on Vercel or if production, otherwise local db.json
const dbPath = process.env.VERCEL || process.env.NODE_ENV === 'production'
  ? path.join('/tmp', 'db.json')
  : path.join(__dirname, 'db.json');

// Helper to read database
function readDB() {
  try {
    if (!fs.existsSync(dbPath)) {
      const initialData = {
        applications: [],
        keys: [],
        variables: [],
        logs: []
      };
      fs.writeFileSync(dbPath, JSON.stringify(initialData, null, 2), 'utf8');
      return initialData;
    }
    const data = fs.readFileSync(dbPath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading JSON db:', err);
    return {
      applications: [],
      keys: [],
      variables: [],
      logs: []
    };
  }
}

// Helper to write database
function writeDB(data) {
  try {
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Error writing JSON db:', err);
  }
}

// Promise wrappers
const query = (sql, params = []) => {
  return new Promise((resolve) => {
    const data = readDB();
    const sqlClean = sql.replace(/\s+/g, ' ').trim();

    // 1. SELECT * FROM applications ORDER BY created_at DESC
    if (sqlClean.includes('SELECT * FROM applications ORDER BY created_at DESC')) {
      const result = [...data.applications].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      return resolve(result);
    }

    // 2. SELECT k.*, a.name AS app_name FROM keys k LEFT JOIN applications a ON k.app_id = a.id ORDER BY k.created_at DESC
    if (sqlClean.includes('SELECT k.*') && sqlClean.includes('FROM keys k')) {
      const result = data.keys.map(k => {
        const app = data.applications.find(a => String(a.id) === String(k.app_id));
        return {
          ...k,
          app_name: app ? app.name : null
        };
      });
      const sorted = result.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      return resolve(sorted);
    }

    // 3. SELECT v.*, a.name AS app_name FROM variables v LEFT JOIN applications a ON v.app_id = a.id ORDER BY v.created_at DESC
    if (sqlClean.includes('SELECT v.*') && sqlClean.includes('FROM variables v')) {
      const result = data.variables.map(v => {
        const app = data.applications.find(a => String(a.id) === String(v.app_id));
        return {
          ...v,
          app_name: app ? app.name : null
        };
      });
      const sorted = result.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      return resolve(sorted);
    }

    // 4. SELECT l.*, a.name AS app_name FROM logs l LEFT JOIN applications a ON l.app_id = a.id ORDER BY l.created_at DESC LIMIT 500
    if (sqlClean.includes('SELECT l.*') && sqlClean.includes('FROM logs l')) {
      const result = data.logs.map(l => {
        const app = data.applications.find(a => String(a.id) === String(l.app_id));
        return {
          ...l,
          app_name: app ? app.name : null
        };
      });
      const sorted = result.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      return resolve(sorted.slice(0, 500));
    }

    console.warn('Unhandled QUERY SQL query:', sql, params);
    resolve([]);
  });
};

const get = (sql, params = []) => {
  return new Promise((resolve) => {
    const data = readDB();
    const sqlClean = sql.replace(/\s+/g, ' ').trim();

    // 1. SELECT * FROM applications WHERE name = ? AND secret = ?
    if (sqlClean.includes('SELECT * FROM applications WHERE name = ? AND secret = ?')) {
      const [name, secret] = params;
      const found = data.applications.find(app => app.name === name && app.secret === secret) || null;
      return resolve(found);
    }

    // 2. SELECT * FROM keys WHERE key_string = ? AND app_id = ?
    if (sqlClean.includes('SELECT * FROM keys WHERE key_string = ? AND app_id = ?')) {
      const [key_string, app_id] = params;
      const found = data.keys.find(k => k.key_string === key_string && String(k.app_id) === String(app_id)) || null;
      return resolve(found);
    }

    // 3. SELECT value FROM variables WHERE app_id = ? AND name = ?
    if (sqlClean.includes('SELECT value FROM variables WHERE app_id = ? AND name = ?')) {
      const [app_id, name] = params;
      const found = data.variables.find(v => String(v.app_id) === String(app_id) && v.name === name) || null;
      return resolve(found);
    }

    console.warn('Unhandled GET SQL query:', sql, params);
    resolve(null);
  });
};

const run = (sql, params = []) => {
  return new Promise((resolve) => {
    const data = readDB();
    const sqlClean = sql.replace(/\s+/g, ' ').trim();
    let changes = 0;
    let lastID = 0;

    // 1. INSERT INTO applications (name, secret) VALUES (?, ?)
    if (sqlClean.includes('INSERT INTO applications (name, secret)')) {
      const [name, secret] = params;
      const newId = data.applications.length > 0 ? Math.max(...data.applications.map(a => a.id)) + 1 : 1;
      data.applications.push({
        id: newId,
        name,
        secret,
        created_at: new Date().toISOString()
      });
      lastID = newId;
      changes = 1;
    }

    // 2. INSERT INTO keys (key_string, app_id, duration_days, duration_unit, note) VALUES (?, ?, ?, ?, ?)
    else if (sqlClean.includes('INSERT INTO keys (key_string, app_id, duration_days, duration_unit, note)')) {
      const [key_string, app_id, duration_days, duration_unit, note] = params;
      const newId = data.keys.length > 0 ? Math.max(...data.keys.map(k => k.id)) + 1 : 1;
      data.keys.push({
        id: newId,
        key_string,
        app_id: Number(app_id),
        duration_days: Number(duration_days),
        duration_unit: duration_unit || 'days',
        status: 'unused',
        hwid: null,
        expires_at: null,
        created_at: new Date().toISOString(),
        last_used_at: null,
        note
      });
      lastID = newId;
      changes = 1;
    }

    // 3. INSERT INTO logs (app_id, key_string, action, ip_address, hwid) VALUES (?, ?, ?, ?, ?)
    else if (sqlClean.includes('INSERT INTO logs (app_id, key_string, action, ip_address, hwid)')) {
      const [app_id, key_string, action, ip_address, hwid] = params;
      const newId = data.logs.length > 0 ? Math.max(...data.logs.map(l => l.id)) + 1 : 1;
      data.logs.push({
        id: newId,
        app_id: app_id ? Number(app_id) : null,
        key_string,
        action,
        ip_address,
        hwid,
        created_at: new Date().toISOString()
      });
      lastID = newId;
      changes = 1;
    }

    // 4. INSERT INTO variables (app_id, name, value) VALUES (?, ?, ?) ON CONFLICT(app_id, name) DO UPDATE SET value = excluded.value
    else if (sqlClean.includes('INSERT INTO variables (app_id, name, value)')) {
      const [app_id, name, value] = params;
      const existingIndex = data.variables.findIndex(v => String(v.app_id) === String(app_id) && v.name === name);
      if (existingIndex !== -1) {
        data.variables[existingIndex].value = value;
        lastID = data.variables[existingIndex].id;
      } else {
        const newId = data.variables.length > 0 ? Math.max(...data.variables.map(v => v.id)) + 1 : 1;
        data.variables.push({
          id: newId,
          app_id: Number(app_id),
          name,
          value,
          created_at: new Date().toISOString()
        });
        lastID = newId;
      }
      changes = 1;
    }

    // 5. UPDATE keys SET status = 'active', hwid = ?, expires_at = ?, last_used_at = CURRENT_TIMESTAMP WHERE id = ?
    else if (sqlClean.includes("UPDATE keys SET status = 'active'")) {
      const [hwid, expires_at, id] = params;
      const key = data.keys.find(k => String(k.id) === String(id));
      if (key) {
        key.status = 'active';
        key.hwid = hwid;
        key.expires_at = expires_at;
        key.last_used_at = new Date().toISOString();
        changes = 1;
      }
    }

    // 6. UPDATE keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?
    else if (sqlClean.includes('UPDATE keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?')) {
      const [id] = params;
      const key = data.keys.find(k => String(k.id) === String(id));
      if (key) {
        key.last_used_at = new Date().toISOString();
        changes = 1;
      }
    }

    // 7. UPDATE keys SET hwid = NULL, status = 'unused', expires_at = NULL WHERE id = ?
    else if (sqlClean.includes("UPDATE keys SET hwid = NULL, status = 'unused', expires_at = NULL")) {
      const [id] = params;
      const key = data.keys.find(k => String(k.id) === String(id));
      if (key) {
        key.hwid = null;
        key.status = 'unused';
        key.expires_at = null;
        changes = 1;
      }
    }

    // 8. UPDATE keys SET status = ? WHERE id = ?
    else if (sqlClean.includes('UPDATE keys SET status = ? WHERE id = ?')) {
      const [status, id] = params;
      const key = data.keys.find(k => String(k.id) === String(id));
      if (key) {
        key.status = status;
        changes = 1;
      }
    }

    // 9. DELETE FROM applications WHERE id = ?
    else if (sqlClean.includes('DELETE FROM applications WHERE id = ?')) {
      const [id] = params;
      const initialCount = data.applications.length;
      data.applications = data.applications.filter(a => String(a.id) !== String(id));
      // Cascade delete associated keys, variables, logs
      data.keys = data.keys.filter(k => String(k.app_id) !== String(id));
      data.variables = data.variables.filter(v => String(v.app_id) !== String(id));
      data.logs = data.logs.filter(l => String(l.app_id) !== String(id));
      changes = initialCount - data.applications.length;
    }

    // 10. DELETE FROM keys WHERE id = ?
    else if (sqlClean.includes('DELETE FROM keys WHERE id = ?')) {
      const [id] = params;
      const initialCount = data.keys.length;
      data.keys = data.keys.filter(k => String(k.id) !== String(id));
      changes = initialCount - data.keys.length;
    }

    // 11. DELETE FROM variables WHERE id = ?
    else if (sqlClean.includes('DELETE FROM variables WHERE id = ?')) {
      const [id] = params;
      const initialCount = data.variables.length;
      data.variables = data.variables.filter(v => String(v.id) !== String(id));
      changes = initialCount - data.variables.length;
    }

    // 12. DELETE FROM logs
    else if (sqlClean.includes('DELETE FROM logs')) {
      const initialCount = data.logs.length;
      data.logs = [];
      changes = initialCount;
    }

    else {
      console.warn('Unhandled RUN SQL query:', sql, params);
    }

    writeDB(data);
    resolve({ id: lastID, changes });
  });
};

module.exports = {
  db: { serialize: (fn) => fn() }, // Stub db for backward compatibility in case server.js accesses it
  query,
  get,
  run
};
