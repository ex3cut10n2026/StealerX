const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// In-memory sessions for active handshakes
// Structure: { [sessionId]: { appId, appName, initializedAt, keyString } }
const sessions = new Map();

// Helper to generate secure random strings
function generateRandomString(length = 16) {
  return crypto.randomBytes(length).toString('hex').slice(0, length);
}

// ----------------------------------------------------
// 1. CLIENT API (Used by Python / Node.js Scripts)
// ----------------------------------------------------

// Handshake: Client initializes the connection
app.post('/api/client/init', async (req, res) => {
  const { app_name, secret } = req.body;
  if (!app_name || !secret) {
    return res.status(400).json({ success: false, message: 'Missing parameters' });
  }

  try {
    const application = await db.get(
      'SELECT * FROM applications WHERE name = ? AND secret = ?',
      [app_name, secret]
    );

    if (!application) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
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
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

// Authenticate License Key
app.post('/api/client/login', async (req, res) => {
  const { session_id, key, hwid } = req.body;
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  if (!session_id || !key || !hwid) {
    return res.status(400).json({ success: false, message: 'Missing parameters' });
  }

  const session = sessions.get(session_id);
  if (!session) {
    return res.status(401).json({ success: false, message: 'Invalid session. Call init first.' });
  }

  try {
    const license = await db.get(
      'SELECT * FROM keys WHERE key_string = ? AND app_id = ?',
      [key, session.appId]
    );

    if (!license) {
      await db.run('INSERT INTO logs (app_id, key_string, action, ip_address, hwid) VALUES (?, ?, ?, ?, ?)',
        [session.appId, key, 'Failed Login (Key not found)', ip, hwid]
      );
      return res.status(404).json({ success: false, message: 'Key not found for this application' });
    }

    if (license.status === 'banned') {
      await db.run('INSERT INTO logs (app_id, key_string, action, ip_address, hwid) VALUES (?, ?, ?, ?, ?)',
        [session.appId, key, 'Failed Login (Banned key)', ip, hwid]
      );
      return res.status(403).json({ success: false, message: 'Key is banned' });
    }

    let expiryDate = license.expires_at;

    // Handle Unused Key Activation
    if (license.status === 'unused') {
      expiryDate = computeExpiry(license.duration_days, license.duration_unit || 'days');

      await db.run(
        `UPDATE keys SET status = 'active', hwid = ?, expires_at = ?, last_used_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [hwid, expiryDate, license.id]
      );
    } else {
      // Key is active, verify HWID
      if (license.hwid && license.hwid !== hwid) {
        await db.run('INSERT INTO logs (app_id, key_string, action, ip_address, hwid) VALUES (?, ?, ?, ?, ?)',
          [session.appId, key, 'Failed Login (HWID mismatch)', ip, hwid]
        );
        return res.status(403).json({ success: false, message: 'HWID does not match key configuration' });
      }

      // Check Expiration
      if (expiryDate && new Date(expiryDate) < new Date()) {
        await db.run('INSERT INTO logs (app_id, key_string, action, ip_address, hwid) VALUES (?, ?, ?, ?, ?)',
          [session.appId, key, 'Failed Login (Expired key)', ip, hwid]
        );
        return res.status(403).json({ success: false, message: 'Key has expired' });
      }

      await db.run(
        `UPDATE keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [license.id]
      );
    }

    // Update in-memory session to link with authenticated key
    session.keyString = key;

    await db.run('INSERT INTO logs (app_id, key_string, action, ip_address, hwid) VALUES (?, ?, ?, ?, ?)',
      [session.appId, key, 'Successful Login', ip, hwid]
    );

    res.json({
      success: true,
      message: 'Authenticated successfully',
      expiry: expiryDate,
      hwid: hwid
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Fetch Remote Variable (Secure storage)
app.post('/api/client/var', async (req, res) => {
  const { session_id, name } = req.body;
  if (!session_id || !name) {
    return res.status(400).json({ success: false, message: 'Missing parameters' });
  }

  const session = sessions.get(session_id);
  if (!session || !session.keyString) {
    return res.status(401).json({ success: false, message: 'Unauthorized. Authenticate license first.' });
  }

  try {
    const variable = await db.get(
      'SELECT value FROM variables WHERE app_id = ? AND name = ?',
      [session.appId, name]
    );

    if (!variable) {
      return res.status(404).json({ success: false, message: 'Variable not found' });
    }

    res.json({
      success: true,
      value: variable.value
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

// Custom Remote Log
app.post('/api/client/log', async (req, res) => {
  const { session_id, message } = req.body;
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  if (!session_id || !message) {
    return res.status(400).json({ success: false, message: 'Missing parameters' });
  }

  const session = sessions.get(session_id);
  if (!session) {
    return res.status(401).json({ success: false, message: 'Invalid session' });
  }

  try {
    await db.run(
      'INSERT INTO logs (app_id, key_string, action, ip_address, hwid) VALUES (?, ?, ?, ?, ?)',
      [session.appId, session.keyString || 'None', `Script Log: ${message}`, ip, 'None']
    );

    res.json({ success: true, message: 'Logged successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});


// ----------------------------------------------------
// 2. ADMIN API (Used by React Frontend Dashboard)
// ----------------------------------------------------

// Get all applications
app.get('/api/admin/apps', async (req, res) => {
  try {
    const apps = await db.query('SELECT * FROM applications ORDER BY created_at DESC');
    res.json({ success: true, data: apps });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Create Application
app.post('/api/admin/apps', async (req, res) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ success: false, message: 'Application name is required' });
  }

  try {
    const secret = 'secret_' + generateRandomString(24);
    const result = await db.run(
      'INSERT INTO applications (name, secret) VALUES (?, ?)',
      [name, secret]
    );
    res.json({ success: true, data: { id: result.id, name, secret } });
  } catch (error) {
    if (error.message.includes('UNIQUE')) {
      return res.status(400).json({ success: false, message: 'Application name already exists' });
    }
    res.status(500).json({ success: false, message: error.message });
  }
});

// Delete Application
app.delete('/api/admin/apps/:id', async (req, res) => {
  try {
    await db.run('DELETE FROM applications WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Application deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get keys/licenses (with optional app filtering)
app.get('/api/admin/keys', async (req, res) => {
  const { app_id } = req.query;
  try {
    let keys;
    if (app_id) {
      keys = await db.query('SELECT * FROM keys WHERE app_id = ? ORDER BY created_at DESC', [app_id]);
    } else {
      keys = await db.query(`
        SELECT keys.*, applications.name as app_name 
        FROM keys 
        LEFT JOIN applications ON keys.app_id = applications.id 
        ORDER BY keys.created_at DESC
      `);
    }
    res.json({ success: true, data: keys });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Helper: compute expiry date from amount + unit
function computeExpiry(amount, unit) {
  const now = new Date();
  switch (unit) {
    case 'seconds': now.setSeconds(now.getSeconds() + amount); break;
    case 'minutes': now.setMinutes(now.getMinutes() + amount); break;
    case 'hours':   now.setHours(now.getHours() + amount); break;
    case 'weeks':   now.setDate(now.getDate() + amount * 7); break;
    case 'months':  now.setMonth(now.getMonth() + amount); break;
    default:        now.setDate(now.getDate() + amount); break; // 'days'
  }
  return now.toISOString();
}

// Generate Keys
app.post('/api/admin/keys/generate', async (req, res) => {
  const { app_id, count, duration_days, duration_unit, note } = req.body;
  if (!app_id || !count || !duration_days) {
    return res.status(400).json({ success: false, message: 'Missing parameters' });
  }

  const unit = duration_unit || 'days';

  try {
    const generated = [];
    for (let i = 0; i < count; i++) {
      const keyStr = 'KEY-' + generateRandomString(12).toUpperCase();
      await db.run(
        'INSERT INTO keys (key_string, app_id, duration_days, duration_unit, note) VALUES (?, ?, ?, ?, ?)',
        [keyStr, app_id, duration_days, unit, note || '']
      );
      generated.push(keyStr);
    }
    res.json({ success: true, data: generated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Reset HWID for key
app.post('/api/admin/keys/reset-hwid', async (req, res) => {
  const { key_id } = req.body;
  try {
    await db.run('UPDATE keys SET hwid = NULL WHERE id = ?', [key_id]);
    res.json({ success: true, message: 'Hardware ID reset successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Ban/Unban Keys
app.post('/api/admin/keys/status', async (req, res) => {
  const { key_id, status } = req.body; // 'active', 'unused', 'banned'
  try {
    await db.run('UPDATE keys SET status = ? WHERE id = ?', [status, key_id]);
    res.json({ success: true, message: `Key status updated to ${status}` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Delete Key
app.delete('/api/admin/keys/:id', async (req, res) => {
  try {
    await db.run('DELETE FROM keys WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'License key deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Variables REST
app.get('/api/admin/variables', async (req, res) => {
  try {
    const variables = await db.query(`
      SELECT variables.*, applications.name as app_name 
      FROM variables 
      LEFT JOIN applications ON variables.app_id = applications.id 
      ORDER BY variables.created_at DESC
    `);
    res.json({ success: true, data: variables });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/admin/variables', async (req, res) => {
  const { app_id, name, value } = req.body;
  if (!app_id || !name || !value) {
    return res.status(400).json({ success: false, message: 'Missing parameters' });
  }

  try {
    // Upsert equivalent in SQLite
    const existing = await db.get('SELECT id FROM variables WHERE app_id = ? AND name = ?', [app_id, name]);
    if (existing) {
      await db.run('UPDATE variables SET value = ? WHERE id = ?', [value, existing.id]);
    } else {
      await db.run('INSERT INTO variables (app_id, name, value) VALUES (?, ?, ?)', [app_id, name, value]);
    }
    res.json({ success: true, message: 'Variable saved successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.delete('/api/admin/variables/:id', async (req, res) => {
  try {
    await db.run('DELETE FROM variables WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Variable deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Logs REST
app.get('/api/admin/logs', async (req, res) => {
  try {
    const logs = await db.query(`
      SELECT logs.*, applications.name as app_name 
      FROM logs 
      LEFT JOIN applications ON logs.app_id = applications.id 
      ORDER BY logs.created_at DESC 
      LIMIT 100
    `);
    res.json({ success: true, data: logs });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.delete('/api/admin/logs', async (req, res) => {
  try {
    await db.run('DELETE FROM logs');
    res.json({ success: true, message: 'All logs cleared' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
