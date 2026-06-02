const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const db = require('./db');

const app = express();

app.use(cors());
app.use(express.json());

// In-memory sessions
const sessions = new Map();

// Generate random string
function generateRandomString(length = 16) {
  return crypto.randomBytes(length).toString('hex').slice(0, length);
}

// Root route
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Key Manager API running'
  });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'ok'
  });
});

// ----------------------------------------------------
// CLIENT API
// ----------------------------------------------------

// Init handshake
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
    }

    session.keyString = key;

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

// ----------------------------------------------------
// ADMIN API
// ----------------------------------------------------

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
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Compute expiry
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

// Export for Vercel
module.exports = app;
