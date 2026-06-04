const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// In-memory sessions
const sessions = new Map();

// ----------------------------------------------------
// Helpers
// ----------------------------------------------------

function generateRandomString(length = 16) {
  return crypto.randomBytes(length).toString('hex').slice(0, length);
}

function computeExpiry(amount, unit) {
  const now = new Date();

  switch (unit) {
    case 'seconds':
      now.setSeconds(now.getSeconds() + amount);
      break;

    case 'minutes':
      now.setMinutes(now.getMinutes() + amount);
      break;

    case 'hours':
      now.setHours(now.getHours() + amount);
      break;

    case 'weeks':
      now.setDate(now.getDate() + amount * 7);
      break;

    case 'months':
      now.setMonth(now.getMonth() + amount);
      break;

    default:
      now.setDate(now.getDate() + amount);
      break;
  }

  return now.toISOString();
}

// ----------------------------------------------------
// ROOT
// ----------------------------------------------------

app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Key Manager API running'
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'ok'
  });
});

// ----------------------------------------------------
// CLIENT API
// ----------------------------------------------------

// Init
app.post('/api/client/init', async (req, res) => {
  const { app_name, secret } = req.body;

  if (!app_name || !secret) {
    return res.status(400).json({
      success: false,
      message: 'Missing parameters'
    });
  }

  try {
    const application = await db.get(
      'SELECT * FROM applications WHERE name = ? AND secret = ?',
      [app_name, secret]
    );

    if (!application) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    const sessionId = generateRandomString(32);

    sessions.set(sessionId, {
      appId: application.id,
      appName: application.name,
      initializedAt: Date.now(),
      keyString: null
    });

    res.json({
      success: true,
      message: 'Initialized successfully',
      session_id: sessionId
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: 'Database error'
    });
  }
});

// Login
app.post('/api/client/login', async (req, res) => {
  const { session_id, key, hwid } = req.body;

  const ip =
    req.headers['x-forwarded-for'] ||
    req.socket.remoteAddress;

  if (!session_id || !key || !hwid) {
    return res.status(400).json({
      success: false,
      message: 'Missing parameters'
    });
  }

  const session = sessions.get(session_id);

  if (!session) {
    return res.status(401).json({
      success: false,
      message: 'Invalid session'
    });
  }

  try {
    const license = await db.get(
      'SELECT * FROM keys WHERE key_string = ? AND app_id = ?',
      [key, session.appId]
    );

    if (!license) {
      return res.status(404).json({
        success: false,
        message: 'Key not found'
      });
    }

    if (license.status === 'banned') {
      return res.status(403).json({
        success: false,
        message: 'Key is banned'
      });
    }

    let expiryDate = license.expires_at;

    if (license.status === 'unused') {
      expiryDate = computeExpiry(
        license.duration_days,
        license.duration_unit || 'days'
      );

      await db.run(
        `UPDATE keys
         SET status = 'active',
         hwid = ?,
         expires_at = ?,
         last_used_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [hwid, expiryDate, license.id]
      );
    } else {
      if (license.hwid && license.hwid !== hwid) {
        return res.status(403).json({
          success: false,
          message: 'HWID mismatch'
        });
      }

      if (
        expiryDate &&
        new Date(expiryDate) < new Date()
      ) {
        return res.status(403).json({
          success: false,
          message: 'Key expired'
        });
      }

      await db.run(
        `UPDATE keys
         SET last_used_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [license.id]
      );
    }

    session.keyString = key;

    await db.run(
      `INSERT INTO logs
       (app_id, key_string, action, ip_address, hwid)
       VALUES (?, ?, ?, ?, ?)`,
      [
        session.appId,
        key,
        'Successful Login',
        ip,
        hwid
      ]
    );

    res.json({
      success: true,
      message: 'Authenticated successfully',
      expiry: expiryDate,
      hwid
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get variable
app.post('/api/client/var', async (req, res) => {
  const { session_id, name } = req.body;

  if (!session_id || !name) {
    return res.status(400).json({
      success: false,
      message: 'Missing parameters'
    });
  }

  const session = sessions.get(session_id);

  if (!session || !session.keyString) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized'
    });
  }

  try {
    const variable = await db.get(
      'SELECT value FROM variables WHERE app_id = ? AND name = ?',
      [session.appId, name]
    );

    if (!variable) {
      return res.status(404).json({
        success: false,
        message: 'Variable not found'
      });
    }

    res.json({
      success: true,
      value: variable.value
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: 'Database error'
    });
  }
});

// Client log
app.post('/api/client/log', async (req, res) => {
  const { session_id, message } = req.body;

  const ip =
    req.headers['x-forwarded-for'] ||
    req.socket.remoteAddress;

  if (!session_id || !message) {
    return res.status(400).json({
      success: false,
      message: 'Missing parameters'
    });
  }

  const session = sessions.get(session_id);

  if (!session) {
    return res.status(401).json({
      success: false,
      message: 'Invalid session'
    });
  }

  try {
    await db.run(
      `INSERT INTO logs
       (app_id, key_string, action, ip_address, hwid)
       VALUES (?, ?, ?, ?, ?)`,
      [
        session.appId,
        session.keyString || 'None',
        `Script Log: ${message}`,
        ip,
        'None'
      ]
    );

    res.json({
      success: true,
      message: 'Logged successfully'
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: 'Database error'
    });
  }
});

// ----------------------------------------------------
// ADMIN API
// ----------------------------------------------------

const ADMIN_PASSWORD = 'St3alerX123?';

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    // Basic simple token for the frontend to store
    const token = Buffer.from(ADMIN_PASSWORD).toString('base64');
    res.json({ success: true, token });
  } else {
    res.status(401).json({ success: false, message: 'Invalid password' });
  }
});

// Admin Auth Middleware
app.use('/api/admin', (req, res, next) => {
  // Allow login route to bypass
  if (req.path === '/login') return next();
  
  const authHeader = req.headers['authorization'];
  const expectedToken = `Bearer ${Buffer.from(ADMIN_PASSWORD).toString('base64')}`;
  
  if (authHeader === expectedToken) {
    next();
  } else {
    res.status(401).json({ success: false, message: 'Unauthorized' });
  }
});


// Get apps
app.get('/api/admin/apps', async (req, res) => {
  try {
    const apps = await db.query(
      'SELECT * FROM applications ORDER BY created_at DESC'
    );

    res.json({
      success: true,
      data: apps
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Create app
app.post('/api/admin/apps', async (req, res) => {
  const { name } = req.body;

  if (!name) {
    return res.status(400).json({
      success: false,
      message: 'Application name required'
    });
  }

  try {
    const secret =
      'secret_' + generateRandomString(24);

    const result = await db.run(
      'INSERT INTO applications (name, secret) VALUES (?, ?)',
      [name, secret]
    );

    res.json({
      success: true,
      data: {
        id: result.id,
        name,
        secret
      }
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Delete app
app.delete('/api/admin/apps/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.run('DELETE FROM applications WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ----------------------------------------------------
// ADMIN – KEYS
// ----------------------------------------------------

// Get all keys
app.get('/api/admin/keys', async (req, res) => {
  try {
    const keys = await db.query(`
      SELECT k.*, a.name AS app_name
      FROM keys k
      LEFT JOIN applications a ON k.app_id = a.id
      ORDER BY k.created_at DESC
    `);
    res.json({ success: true, data: keys });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Generate keys
app.post('/api/admin/keys/generate', async (req, res) => {
  const { app_id, count = 1, duration_days = 30, duration_unit = 'days', note = '', prefix = 'KEY-' } = req.body;
  if (!app_id) return res.status(400).json({ success: false, message: 'app_id required' });
  try {
    const generated = [];
    for (let i = 0; i < Math.min(count, 100); i++) {
      const keyString = prefix + generateRandomString(16).toUpperCase();
      await db.run(
        'INSERT INTO keys (key_string, app_id, duration_days, duration_unit, note) VALUES (?, ?, ?, ?, ?)',
        [keyString, app_id, duration_days, duration_unit, note]
      );
      generated.push(keyString);
    }
    res.json({ success: true, data: generated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Reset HWID
app.post('/api/admin/keys/reset-hwid', async (req, res) => {
  const { key_id } = req.body;
  if (!key_id) return res.status(400).json({ success: false, message: 'key_id required' });
  try {
    await db.run('UPDATE keys SET hwid = NULL, status = \'unused\', expires_at = NULL WHERE id = ?', [key_id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update key status (ban / unban)
app.post('/api/admin/keys/status', async (req, res) => {
  const { key_id, status } = req.body;
  if (!key_id || !status) return res.status(400).json({ success: false, message: 'key_id and status required' });
  try {
    await db.run('UPDATE keys SET status = ? WHERE id = ?', [status, key_id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Delete key
app.delete('/api/admin/keys/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.run('DELETE FROM keys WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ----------------------------------------------------
// ADMIN – VARIABLES
// ----------------------------------------------------

// Get all variables
app.get('/api/admin/variables', async (req, res) => {
  try {
    const vars = await db.query(`
      SELECT v.*, a.name AS app_name
      FROM variables v
      LEFT JOIN applications a ON v.app_id = a.id
      ORDER BY v.created_at DESC
    `);
    res.json({ success: true, data: vars });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Create / update variable
app.post('/api/admin/variables', async (req, res) => {
  const { app_id, name, value } = req.body;
  if (!app_id || !name || !value) return res.status(400).json({ success: false, message: 'app_id, name, value required' });
  try {
    await db.run(
      'INSERT INTO variables (app_id, name, value) VALUES (?, ?, ?) ON CONFLICT(app_id, name) DO UPDATE SET value = excluded.value',
      [app_id, name, value]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Delete variable
app.delete('/api/admin/variables/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.run('DELETE FROM variables WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ----------------------------------------------------
// ADMIN – LOGS
// ----------------------------------------------------

// Get logs
app.get('/api/admin/logs', async (req, res) => {
  try {
    const logs = await db.query(`
      SELECT l.*, a.name AS app_name
      FROM logs l
      LEFT JOIN applications a ON l.app_id = a.id
      ORDER BY l.created_at DESC
      LIMIT 500
    `);
    res.json({ success: true, data: logs });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Clear logs
app.delete('/api/admin/logs', async (req, res) => {
  try {
    await db.run('DELETE FROM logs');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ----------------------------------------------------
// START SERVER
// ----------------------------------------------------

if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;