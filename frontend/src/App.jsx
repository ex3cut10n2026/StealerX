import React, { useState, useEffect, useCallback } from 'react';

// ─── Utility ────────────────────────────────────────────────────────────────
const copyToClipboard = async (text, cb) => {
  try {
    await navigator.clipboard.writeText(text);
    if (cb) cb();
  } catch {
    const el = document.createElement('textarea');
    el.value = text;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    if (cb) cb();
  }
};

const CopyBtn = ({ text, small }) => {
  const [copied, setCopied] = useState(false);
  const handle = (e) => {
    e.stopPropagation();
    copyToClipboard(text, () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };
  return (
    <button
      className={`copy-btn${small ? ' copy-btn-sm' : ''}`}
      onClick={handle}
      title="Copy to clipboard"
    >
      {copied ? '✓' : '⎘'}
    </button>
  );
};

// ─── Icons ───────────────────────────────────────────────────────────────────
const icons = {
  dashboard: '◈',
  apps:      '⊞',
  keys:      '⚿',
  variables: '≡',
  logs:      '⋮',
  guide:     '⊙',
};

// ─── Login Screen ────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [showPwd, setShowPwd]   = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res  = await fetch('/api/admin/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ password })
      });
      const data = await res.json();
      if (data.success) {
        localStorage.setItem('adminToken', data.token);
        onLogin(data.token);
      } else {
        setError('Mot de passe incorrect. Réessayez.');
      }
    } catch {
      setError('Erreur de connexion au serveur.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-overlay">
      <div className="bg-ambient">
        <div className="ambient-orb-1"></div>
        <div className="ambient-orb-2"></div>
        <div className="ambient-orb-3"></div>
      </div>
      <div className="login-card">
        <div className="login-logo">
          <div className="logo-icon" style={{ width: '56px', height: '56px', fontSize: '1.4rem' }}>KS</div>
          <h1 className="login-title">KeyShield</h1>
          <p className="login-sub">Panneau d'Administration</p>
        </div>
        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label htmlFor="login-pwd">Mot de passe administrateur</label>
            <div style={{ position: 'relative' }}>
              <input
                id="login-pwd"
                type={showPwd ? 'text' : 'password'}
                className="form-control"
                placeholder="••••••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                style={{ paddingRight: '3rem' }}
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowPwd(v => !v)}
                style={{
                  position: 'absolute', right: '0.75rem', top: '50%',
                  transform: 'translateY(-50%)', background: 'none',
                  border: 'none', cursor: 'pointer', color: 'var(--text-muted)',
                  fontSize: '1rem', padding: 0
                }}
              >{showPwd ? '🙈' : '👁'}</button>
            </div>
          </div>
          {error && (
            <div className="login-error">
              <span>✕</span> {error}
            </div>
          )}
          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', padding: '0.85rem', fontSize: '1rem' }}
            disabled={loading}
          >
            {loading ? '⏳ Connexion…' : '🔐 Se Connecter'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Main App ────────────────────────────────────────────────────────────────
function App() {
  // ── Auth ───────────────────────────────────────────────────────────────────
  const [token, setToken] = useState(() => localStorage.getItem('adminToken'));

  const handleLogin  = (t) => setToken(t);
  const handleLogout = () => {
    localStorage.removeItem('adminToken');
    setToken(null);
  };

  // ── Admin fetch helper (adds Bearer token to every admin request) ───────────
  const adminFetch = useCallback(async (url, options = {}) => {
    const headers = {
      ...options.headers,
      'Authorization': `Bearer ${token}`
    };
    const res = await fetch(url, { ...options, headers });
    if (res.status === 401) {
      handleLogout();
    }
    return res;
  }, [token]);

  // Show login screen if not authenticated
  if (!token) return <LoginScreen onLogin={handleLogin} />;

  const [activeTab, setActiveTab]       = useState('dashboard');
  const [apps, setApps]                 = useState([]);
  const [keys, setKeys]                 = useState([]);
  const [variables, setVariables]       = useState([]);
  const [logs, setLogs]                 = useState([]);

  // Selected Application for key creation/filtering
  const [selectedAppId, setSelectedAppId] = useState('');

  // Form States
  const [newAppName, setNewAppName]     = useState('');

  // Key Gen State
  const [keyCount, setKeyCount]         = useState(1);
  const [keyDuration, setKeyDuration]   = useState(30);
  const [keyUnit, setKeyUnit]           = useState('days');
  const [keyNote, setKeyNote]           = useState('');
  const [keyPrefix, setKeyPrefix]       = useState('KEY-');
  const [keyFilter, setKeyFilter]       = useState('');
  const [keyAppFilter, setKeyAppFilter] = useState('');

  // Variable State
  const [varAppId, setVarAppId]         = useState('');
  const [varName, setVarName]           = useState('');
  const [varValue, setVarValue]         = useState('');

  // Generated keys modal
  const [generatedKeys, setGeneratedKeys] = useState([]);
  const [showGenModal, setShowGenModal]   = useState(false);

  // Notification State
  const [notification, setNotification] = useState(null);

  const showNotification = (message, type = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 4000);
  };

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const fetchApps = useCallback(async () => {
    try {
      const res  = await adminFetch('/api/admin/apps');
      const data = await res.json();
      if (data.success) {
        setApps(data.data);
        if (data.data.length > 0 && !selectedAppId) {
          setSelectedAppId(data.data[0].id);
          setVarAppId(data.data[0].id);
        }
      }
    } catch { showNotification('Error fetching applications', 'danger'); }
  }, [selectedAppId, adminFetch]);

  const fetchKeys      = async () => {
    try { const r = await adminFetch('/api/admin/keys');      const d = await r.json(); if (d.success) setKeys(d.data);      } catch { showNotification('Error fetching keys', 'danger'); }
  };
  const fetchVariables = async () => {
    try { const r = await adminFetch('/api/admin/variables'); const d = await r.json(); if (d.success) setVariables(d.data); } catch { showNotification('Error fetching variables', 'danger'); }
  };
  const fetchLogs      = async () => {
    try { const r = await adminFetch('/api/admin/logs');      const d = await r.json(); if (d.success) setLogs(d.data);      } catch { showNotification('Error fetching logs', 'danger'); }
  };

  const refreshAll = () => { fetchApps(); fetchKeys(); fetchVariables(); fetchLogs(); };

  useEffect(() => { refreshAll(); }, []);

  // ── Actions ────────────────────────────────────────────────────────────────
  const handleCreateApp = async (e) => {
    e.preventDefault();
    if (!newAppName.trim()) return;
    try {
      const res  = await adminFetch('/api/admin/apps', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newAppName }) });
      const data = await res.json();
      if (data.success) { showNotification(`Application "${newAppName}" created!`); setNewAppName(''); fetchApps(); }
      else showNotification(data.message, 'danger');
    } catch { showNotification('Failed to create application', 'danger'); }
  };

  const handleDeleteApp = async (id) => {
    if (!confirm('Delete this application? All keys and data will be lost.')) return;
    try {
      const res  = await adminFetch(`/api/admin/apps/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) { showNotification('Application deleted'); refreshAll(); }
    } catch { showNotification('Failed to delete application', 'danger'); }
  };

  const handleGenerateKeys = async (e) => {
    e.preventDefault();
    if (!selectedAppId) { showNotification('Veuillez sélectionner une application', 'danger'); return; }
    try {
      const res  = await adminFetch('/api/admin/keys/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app_id: selectedAppId, count: parseInt(keyCount), duration_days: parseInt(keyDuration), duration_unit: keyUnit, note: keyNote, prefix: keyPrefix }) });
      const data = await res.json();
      if (data.success) {
        showNotification(`${keyCount} clé(s) générée(s) avec succès !`);
        setKeyNote('');
        setGeneratedKeys(data.data);
        setShowGenModal(true);
        fetchKeys();
      } else showNotification(data.message, 'danger');
    } catch { showNotification('Échec de génération', 'danger'); }
  };

  const handleResetHWID = async (keyId) => {
    try {
      const res  = await adminFetch('/api/admin/keys/reset-hwid', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key_id: keyId }) });
      const data = await res.json();
      if (data.success) { showNotification('HWID reset successfully'); fetchKeys(); }
    } catch { showNotification('Failed to reset HWID', 'danger'); }
  };

  const handleToggleBan = async (keyId, currentStatus) => {
    const newStatus = currentStatus === 'banned' ? 'active' : 'banned';
    try {
      const res  = await adminFetch('/api/admin/keys/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key_id: keyId, status: newStatus }) });
      const data = await res.json();
      if (data.success) { showNotification(`Key ${newStatus === 'banned' ? 'banned' : 'unbanned'}`); fetchKeys(); }
    } catch { showNotification('Failed to update status', 'danger'); }
  };

  const handleDeleteKey = async (keyId) => {
    if (!confirm('Delete this key?')) return;
    try {
      const res  = await adminFetch(`/api/admin/keys/${keyId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) { showNotification('Key deleted'); fetchKeys(); }
    } catch { showNotification('Failed to delete key', 'danger'); }
  };

  const handleSaveVariable = async (e) => {
    e.preventDefault();
    if (!varAppId || !varName || !varValue) return;
    try {
      const res  = await adminFetch('/api/admin/variables', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app_id: varAppId, name: varName, value: varValue }) });
      const data = await res.json();
      if (data.success) { showNotification('Variable saved'); setVarName(''); setVarValue(''); fetchVariables(); }
    } catch { showNotification('Failed to save variable', 'danger'); }
  };

  const handleDeleteVariable = async (id) => {
    if (!confirm('Delete this variable?')) return;
    try {
      const res  = await adminFetch(`/api/admin/variables/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) { showNotification('Variable deleted'); fetchVariables(); }
    } catch { showNotification('Failed to delete variable', 'danger'); }
  };

  const handleClearLogs = async () => {
    if (!confirm('Clear all action logs?')) return;
    try {
      const res  = await adminFetch('/api/admin/logs', { method: 'DELETE' });
      const data = await res.json();
      if (data.success) { showNotification('Logs cleared'); fetchLogs(); }
    } catch { showNotification('Failed to clear logs', 'danger'); }
  };

  // ── Derived stats ──────────────────────────────────────────────────────────
  const stats = {
    totalApps:    apps.length,
    totalKeys:    keys.length,
    activeKeys:   keys.filter(k => k.status === 'active').length,
    unusedKeys:   keys.filter(k => k.status === 'unused').length,
    bannedKeys:   keys.filter(k => k.status === 'banned').length,
    totalVars:    variables.length,
    totalLogs:    logs.length,
    successLogins: logs.filter(l => l.action.includes('Success')).length,
    failedLogins:  logs.filter(l => l.action.includes('Failed')).length,
  };

  // ── Filtered keys ──────────────────────────────────────────────────────────
  const filteredKeys = keys.filter(k => {
    const matchText = !keyFilter || k.key_string.toLowerCase().includes(keyFilter.toLowerCase()) || (k.note || '').toLowerCase().includes(keyFilter.toLowerCase());
    const matchApp  = !keyAppFilter || String(k.app_id) === String(keyAppFilter);
    return matchText && matchApp;
  });

  const tabLabels = {
    dashboard: 'Tableau de bord',
    apps:      'Applications',
    keys:      'Clés de Licence',
    variables: 'Variables Distantes',
    logs:      'Logs d\'Accès',
    guide:     'Guide d\'Intégration',
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="app-container">
      {/* Ambient backgrounds */}
      <div className="bg-ambient">
        <div className="ambient-orb-1"></div>
        <div className="ambient-orb-2"></div>
        <div className="ambient-orb-3"></div>
      </div>

      {/* Toast Notification */}
      {notification && (
        <div className={`toast toast-${notification.type}`}>
          <span className="toast-icon">{notification.type === 'success' ? '✓' : '✕'}</span>
          {notification.message}
        </div>
      )}

      {/* Generated Keys Modal */}
      {showGenModal && (
        <div className="modal-overlay" onClick={() => setShowGenModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">🎉 Clés Générées</span>
              <button className="close-btn" onClick={() => setShowGenModal(false)}>✕</button>
            </div>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem', fontSize: '1rem' }}>
              {generatedKeys.length} clé(s) créée(s) avec succès. Copiez-les maintenant !
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '320px', overflowY: 'auto' }}>
              {generatedKeys.map((k, i) => (
                <div key={i} className="gen-key-row">
                  <code className="gen-key-code">{k}</code>
                  <CopyBtn text={k} small />
                </div>
              ))}
            </div>
            <button
              className="btn btn-primary"
              style={{ width: '100%', marginTop: '1.25rem' }}
              onClick={() => {
                copyToClipboard(generatedKeys.join('\n'), () => showNotification('Toutes les clés ont été copiées !'));
                setShowGenModal(false);
              }}
            >
              Tout Copier & Fermer
            </button>
          </div>
        </div>
      )}

      {/* Sidebar */}
      <div className="sidebar">
        <div className="logo-container">
          <div className="logo-icon">KS</div>
          <span className="logo-text">KeyShield</span>
        </div>
        <button
          className="btn btn-secondary"
          style={{ margin: '0 1rem', padding: '0.5rem 1rem', fontSize: '0.85rem', color: 'var(--danger)' }}
          onClick={handleLogout}
          title="Se déconnecter"
        >
          ⎋ Déconnexion
        </button>
        <ul className="nav-links">
          {Object.entries(tabLabels).map(([key, label]) => (
            <li
              key={key}
              className={`nav-item ${activeTab === key ? 'active' : ''}`}
              onClick={() => setActiveTab(key)}
            >
              <span className="nav-icon">{icons[key]}</span>
              {label}
            </li>
          ))}
        </ul>

        {/* Sidebar footer stats */}
        <div className="sidebar-footer">
          <div className="sidebar-stat">
            <span className="sidebar-stat-dot dot-green"></span>
            <span>{stats.activeKeys} actives</span>
          </div>
          <div className="sidebar-stat">
            <span className="sidebar-stat-dot dot-red"></span>
            <span>{stats.bannedKeys} bannies</span>
          </div>
          <button className="btn btn-secondary btn-refresh" onClick={refreshAll} title="Rafraîchir">↺ Rafraîchir</button>
        </div>
      </div>

      {/* Main Panel */}
      <main className="main-content">
        <div className="dashboard-header">
          <div className="page-title">
            <h1>
              <span className="page-title-icon">{icons[activeTab]}</span>
              {tabLabels[activeTab]}
            </h1>
            <p>
              {activeTab === 'dashboard'  && 'Aperçu global de votre système.'}
              {activeTab === 'apps'       && 'Gérez vos scripts et applications API.'}
              {activeTab === 'keys'       && 'Générez, configurez et surveillez vos clés de licence.'}
              {activeTab === 'variables'  && 'Injectez des variables distantes en toute sécurité.'}
              {activeTab === 'logs'       && 'Journal d\'audit en temps réel des connexions clients.'}
              {activeTab === 'guide'      && 'Apprenez comment intégrer la vérification dans vos scripts.'}
            </p>
          </div>
        </div>

        {/* ── 0. DASHBOARD ────────────────────────────────────────────── */}
        {activeTab === 'dashboard' && (
          <div>
            {/* Stat cards */}
            <div className="stats-grid">
              <div className="glass-card stat-card">
                <div className="stat-icon" style={{ background: 'rgba(99,102,241,0.15)', color: 'var(--accent-color)' }}>⊞</div>
                <div className="stat-title">Applications</div>
                <div className="stat-value">{stats.totalApps}</div>
              </div>
              <div className="glass-card stat-card">
                <div className="stat-icon" style={{ background: 'rgba(16,185,129,0.15)', color: 'var(--success)' }}>⚿</div>
                <div className="stat-title">Clés Actives</div>
                <div className="stat-value" style={{ color: 'var(--success)' }}>{stats.activeKeys}</div>
              </div>
              <div className="glass-card stat-card">
                <div className="stat-icon" style={{ background: 'rgba(245,158,11,0.15)', color: 'var(--warning)' }}>◌</div>
                <div className="stat-title">Clés Inutilisées</div>
                <div className="stat-value" style={{ color: 'var(--warning)' }}>{stats.unusedKeys}</div>
              </div>
              <div className="glass-card stat-card">
                <div className="stat-icon" style={{ background: 'rgba(239,68,68,0.15)', color: 'var(--danger)' }}>⊘</div>
                <div className="stat-title">Clés Bannies</div>
                <div className="stat-value" style={{ color: 'var(--danger)' }}>{stats.bannedKeys}</div>
              </div>
              <div className="glass-card stat-card">
                <div className="stat-icon" style={{ background: 'rgba(99,102,241,0.15)', color: '#a78bfa' }}>≡</div>
                <div className="stat-title">Variables Distantes</div>
                <div className="stat-value">{stats.totalVars}</div>
              </div>
              <div className="glass-card stat-card">
                <div className="stat-icon" style={{ background: 'rgba(16,185,129,0.15)', color: 'var(--success)' }}>✓</div>
                <div className="stat-title">Connexions Réussies</div>
                <div className="stat-value" style={{ color: 'var(--success)' }}>{stats.successLogins}</div>
              </div>
            </div>

            {/* Two-column bottom */}
            <div className="grid-2">
              {/* Apps overview */}
              <div className="glass-card">
                <h2 style={{ marginBottom: '1rem' }}>Applications</h2>
                {apps.length === 0 ? (
                  <div className="empty-state">No applications yet.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {apps.map(app => {
                      const appKeys   = keys.filter(k => k.app_id === app.id);
                      const appActive = appKeys.filter(k => k.status === 'active').length;
                      return (
                        <div key={app.id} className="app-row">
                          <div>
                            <div style={{ fontWeight: 600 }}>{app.name}</div>
                            <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                              {appKeys.length} keys · {appActive} active
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: '0.4rem' }}>
                            <span className="badge badge-active">{appActive} active</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Recent logs */}
              <div className="glass-card">
                <h2 style={{ marginBottom: '1rem' }}>Activité Récente</h2>
                {logs.length === 0 ? (
                  <div className="empty-state">Aucune activité pour le moment.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {logs.slice(0, 8).map(log => (
                      <div key={log.id} className="log-item">
                        <div>
                          <div className="log-action">
                            <span style={{
                              color: log.action.includes('Success') ? 'var(--success)' : log.action.includes('Failed') ? 'var(--danger)' : 'var(--text-secondary)',
                              marginRight: '0.5rem'
                            }}>
                              {log.action.includes('Success') ? '✓' : log.action.includes('Failed') ? '✗' : 'ℹ'}
                            </span>
                            {log.action}
                          </div>
                          <div className="log-meta">{log.app_name} · {log.key_string}</div>
                        </div>
                        <div className="log-meta" style={{ textAlign: 'right' }}>
                          <div style={{ color: 'var(--text-primary)', marginBottom: '0.15rem' }}>{log.ip_address}</div>
                          {new Date(log.created_at).toLocaleTimeString()}
                        </div>
                      </div>
                    ))}
                    {logs.length > 8 && (
                      <button className="btn btn-secondary" style={{ marginTop: '0.75rem', width: '100%' }} onClick={() => setActiveTab('logs')}>
                        View all {logs.length} logs →
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── 1. APPLICATIONS ─────────────────────────────────────────── */}
        {activeTab === 'apps' && (
          <div className="grid-2">
            <div className="glass-card">
              <h2 style={{ marginBottom: '1.25rem' }}>Créer une application</h2>
              <form onSubmit={handleCreateApp}>
                <div className="form-group">
                  <label htmlFor="app-name">Nom de l'application</label>
                  <input
                    id="app-name"
                    type="text"
                    className="form-control"
                    placeholder="ex. Script Premium v2"
                    value={newAppName}
                    onChange={(e) => setNewAppName(e.target.value)}
                  />
                </div>
                <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
                  ＋ Créer l'application
                </button>
              </form>
            </div>

            <div className="glass-card" style={{ gridColumn: 'span 2' }}>
              <h2 style={{ marginBottom: '1rem' }}>Applications Actives</h2>
              {apps.length === 0 ? (
                <div className="empty-state">Aucune application trouvée. Créez-en une pour commencer !</div>
              ) : (
                <div className="table-container">
                  <table>
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Nom</th>
                        <th>Secret d'App</th>
                        <th>Clés</th>
                        <th>Créé le</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {apps.map((app) => {
                        const appKeyCount = keys.filter(k => k.app_id === app.id).length;
                        return (
                          <tr key={app.id}>
                            <td style={{ color: 'var(--text-muted)' }}>#{app.id}</td>
                            <td><strong>{app.name}</strong></td>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <code className="secret-code">{app.secret}</code>
                                <CopyBtn text={app.secret} small />
                              </div>
                            </td>
                            <td><span className="badge badge-active">{appKeyCount}</span></td>
                            <td style={{ color: 'var(--text-muted)' }}>{new Date(app.created_at).toLocaleString()}</td>
                            <td>
                              <button className="btn btn-danger" onClick={() => handleDeleteApp(app.id)} style={{ padding: '0.6rem 1rem', fontSize: '0.95rem' }}>
                                Supprimer
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── 2. LICENSE KEYS ─────────────────────────────────────────── */}
        {activeTab === 'keys' && (
          <div className="grid-2">
            <div className="glass-card">
              <h2 style={{ marginBottom: '1.25rem' }}>Générer des Clés</h2>
              <form onSubmit={handleGenerateKeys}>
                <div className="form-group">
                  <label htmlFor="key-app">Application</label>
                  <select
                    id="key-app"
                    className="form-control"
                    value={selectedAppId}
                    onChange={(e) => setSelectedAppId(e.target.value)}
                  >
                    <option value="">-- Choisir une App --</option>
                    {apps.map((app) => (
                      <option key={app.id} value={app.id}>{app.name}</option>
                    ))}
                  </select>
                </div>
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label htmlFor="key-prefix">Préfixe</label>
                    <input id="key-prefix" type="text" className="form-control" placeholder="ex. ABC-" value={keyPrefix} onChange={(e) => setKeyPrefix(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label htmlFor="key-count">Quantité</label>
                    <input id="key-count" type="number" min="1" max="100" className="form-control" value={keyCount} onChange={(e) => setKeyCount(e.target.value)} />
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="key-dur">Durée</label>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <input id="key-dur" type="number" min="1" max="99999" className="form-control" value={keyDuration} onChange={(e) => setKeyDuration(e.target.value)} style={{ flex: 1 }} />
                    <select
                      id="key-unit"
                      className="form-control"
                      value={keyUnit}
                      onChange={(e) => setKeyUnit(e.target.value)}
                      style={{ width: '120px', flexShrink: 0 }}
                    >
                      <option value="seconds">Secondes</option>
                      <option value="minutes">Minutes</option>
                      <option value="hours">Heures</option>
                      <option value="days">Jours</option>
                      <option value="weeks">Semaines</option>
                      <option value="months">Mois</option>
                    </select>
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="key-note">Note / Commentaires (Optionnel)</label>
                  <input id="key-note" type="text" className="form-control" placeholder="ex. Testeur Beta" value={keyNote} onChange={(e) => setKeyNote(e.target.value)} />
                </div>
                <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem' }}>
                  ⚿ Générer les Clés
                </button>
              </form>
            </div>

            <div className="glass-card" style={{ gridColumn: 'span 2' }}>
              {/* Search / filter bar */}
              <div className="flex-space" style={{ marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
                <h2>Clés de Licence <span style={{ fontSize: '1.2rem', fontWeight: 400, color: 'var(--text-muted)' }}>({filteredKeys.length}/{keys.length})</span></h2>
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="🔍 Chercher une clé ou note…"
                    value={keyFilter}
                    onChange={e => setKeyFilter(e.target.value)}
                    style={{ minWidth: '220px', padding: '0.55rem 1rem' }}
                  />
                  <select
                    className="form-control"
                    value={keyAppFilter}
                    onChange={e => setKeyAppFilter(e.target.value)}
                    style={{ minWidth: '160px', padding: '0.55rem 1rem' }}
                  >
                    <option value="">Toutes les Apps</option>
                    {apps.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
              </div>

              {filteredKeys.length === 0 ? (
                <div className="empty-state">Aucune clé ne correspond à votre filtre. <span style={{ cursor: 'pointer', color: 'var(--accent-color)' }} onClick={() => { setKeyFilter(''); setKeyAppFilter(''); }}>Effacer le filtre</span></div>
              ) : (
                <div className="table-container">
                  <table>
                    <thead>
                      <tr>
                        <th>Clé</th>
                        <th>Application</th>
                        <th>Durée</th>
                        <th>HWID</th>
                        <th>Expire le</th>
                        <th>Statut</th>
                        <th>Note</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredKeys.map((key) => (
                        <tr key={key.id}>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <strong style={{ fontFamily: 'monospace', letterSpacing: '0.5px' }}>{key.key_string}</strong>
                              <CopyBtn text={key.key_string} small />
                            </div>
                          </td>
                          <td>{key.app_name}</td>
                          <td>{key.duration_days} {{
                            seconds: 's', minutes: 'min', hours: 'h', days: 'j', weeks: 'sem', months: 'mois'
                          }[key.duration_unit] || 'j'}</td>
                          <td>
                            {key.hwid ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span style={{ fontSize: '0.9rem', opacity: 0.7, fontFamily: 'monospace' }}>{key.hwid.slice(0, 10)}…</span>
                                <button className="btn btn-secondary" onClick={() => handleResetHWID(key.id)} style={{ padding: '0.3rem 0.6rem', fontSize: '0.85rem' }}>
                                  Reset
                                </button>
                              </div>
                            ) : (
                              <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Non liée</span>
                            )}
                          </td>
                          <td style={{ fontSize: '1rem' }}>
                            {key.expires_at ? (() => {
                              const exp = new Date(key.expires_at);
                              const now = new Date();
                              const diff = Math.ceil((exp - now) / 86400000);
                              const expired = diff < 0;
                              return (
                                <span style={{ color: expired ? 'var(--danger)' : diff < 7 ? 'var(--warning)' : 'inherit' }}>
                                  {exp.toLocaleDateString()}
                                  {!expired && <span style={{ fontSize: '0.85rem', marginLeft: '0.3rem', opacity: 0.6 }}>({diff}j)</span>}
                                  {expired && <span style={{ fontSize: '0.85rem', marginLeft: '0.3rem' }}>(expiré)</span>}
                                </span>
                              );
                            })() : <span style={{ color: 'var(--text-muted)' }}>Inactif</span>}
                          </td>
                          <td>
                            <span className={`badge badge-${key.status}`}>{key.status}</span>
                          </td>
                          <td><span style={{ fontSize: '0.95rem', color: 'var(--text-muted)' }}>{key.note || '—'}</span></td>
                          <td>
                            <div style={{ display: 'flex', gap: '0.4rem' }}>
                              <button
                                className={`btn ${key.status === 'banned' ? 'btn-secondary' : 'btn-secondary'}`}
                                onClick={() => handleToggleBan(key.id, key.status)}
                                style={{ padding: '0.4rem 0.8rem', fontSize: '0.9rem', color: key.status === 'banned' ? 'var(--success)' : 'var(--warning)' }}
                              >
                                {key.status === 'banned' ? 'Unban' : 'Ban'}
                              </button>
                              <button className="btn btn-danger" onClick={() => handleDeleteKey(key.id)} style={{ padding: '0.4rem 0.8rem', fontSize: '0.9rem' }}>
                                Del
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── 3. REMOTE VARIABLES ─────────────────────────────────────── */}
        {activeTab === 'variables' && (
          <div className="grid-2">
            <div className="glass-card">
              <h2 style={{ marginBottom: '1.25rem' }}>Ajouter une Variable Distante</h2>
              <form onSubmit={handleSaveVariable}>
                <div className="form-group">
                  <label htmlFor="var-app">Application</label>
                  <select id="var-app" className="form-control" value={varAppId} onChange={(e) => setVarAppId(e.target.value)}>
                    <option value="">-- Choisir une App --</option>
                    {apps.map((app) => (<option key={app.id} value={app.id}>{app.name}</option>))}
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="var-name">Nom de la Variable</label>
                  <input id="var-name" type="text" className="form-control" placeholder="ex. message_bienvenue" value={varName} onChange={(e) => setVarName(e.target.value)} />
                </div>
                <div className="form-group">
                  <label htmlFor="var-val">Valeur de la Variable</label>
                  <textarea id="var-val" rows="4" className="form-control" placeholder="Détails sécurisés, paramètres de scripts..." value={varValue} onChange={(e) => setVarValue(e.target.value)} style={{ resize: 'vertical' }}></textarea>
                </div>
                <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem' }}>
                  Enregistrer la Variable
                </button>
              </form>
            </div>

            <div className="glass-card" style={{ gridColumn: 'span 2' }}>
              <h2 style={{ marginBottom: '1rem' }}>Variables de Script Distantes</h2>
              {variables.length === 0 ? (
                <div className="empty-state">Aucune variable configurée. Créez-en une au-dessus !</div>
              ) : (
                <div className="table-container">
                  <table>
                    <thead>
                      <tr>
                        <th>Nom</th>
                        <th>Application</th>
                        <th>Aperçu de la Valeur</th>
                        <th>Créé le</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {variables.map((variable) => (
                        <tr key={variable.id}>
                          <td><strong>{variable.name}</strong></td>
                          <td>{variable.app_name}</td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <code className="secret-code" style={{ maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {variable.value}
                              </code>
                              <CopyBtn text={variable.value} small />
                            </div>
                          </td>
                          <td style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>{new Date(variable.created_at).toLocaleString()}</td>
                          <td>
                            <button className="btn btn-danger" onClick={() => handleDeleteVariable(variable.id)} style={{ padding: '0.6rem 1rem', fontSize: '0.95rem' }}>
                              Supprimer
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── 4. ACCESS LOGS ──────────────────────────────────────────── */}
        {activeTab === 'logs' && (
          <div className="glass-card">
            <div className="flex-space" style={{ marginBottom: '1.5rem' }}>
              <div>
                <h2>Journaux d'Audit de Sécurité</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', marginTop: '0.25rem' }}>
                  {stats.successLogins} réussies · {stats.failedLogins} échouées · {stats.totalLogs} au total
                </p>
              </div>
              <button className="btn btn-danger" onClick={handleClearLogs} disabled={logs.length === 0}>
                🗑 Effacer tous les logs
              </button>
            </div>

            {logs.length === 0 ? (
              <div className="empty-state">Aucun log d'exécution trouvé.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {logs.map((log) => (
                  <div key={log.id} className={`log-item log-item-${log.action.includes('Success') ? 'success' : log.action.includes('Failed') ? 'danger' : 'info'}`}>
                    <div>
                      <div className="log-action">
                        <span style={{
                          color: log.action.includes('Success') ? 'var(--success)' :
                                 log.action.includes('Failed')  ? 'var(--danger)'  : 'var(--text-secondary)',
                          marginRight: '0.75rem',
                          fontWeight: 'bold'
                        }}>
                          {log.action.includes('Success') ? '✓' : log.action.includes('Failed') ? '✗' : 'ℹ'}
                        </span>
                        {log.action}
                      </div>
                      <div className="log-meta" style={{ marginTop: '0.3rem' }}>
                        App: <strong>{log.app_name}</strong> &nbsp;·&nbsp; Key: <code style={{ fontSize: '0.95rem' }}>{log.key_string}</code>
                        {log.hwid && log.hwid !== 'None' && <>&nbsp;·&nbsp; HWID: <code style={{ fontSize: '0.95rem' }}>{log.hwid.slice(0, 12)}…</code></>}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: '0.95rem' }}>{log.ip_address}</div>
                      <div className="log-meta">{new Date(log.created_at).toLocaleString()}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── 5. INTEGRATION GUIDE ────────────────────────────────────── */}
        {activeTab === 'guide' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div className="glass-card">
              <h2>Guide d'Intégration</h2>
              <p style={{ margin: '0.5rem 0 1.5rem 0', color: 'var(--text-secondary)' }}>
                Copiez et collez ces exemples d'intégration client dans vos scripts d'automatisation.
                Remplacez <code style={{ background: 'rgba(255,255,255,0.06)', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>YOUR_APP_NAME</code> et <code style={{ background: 'rgba(255,255,255,0.06)', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>YOUR_APP_SECRET</code> avec les vraies valeurs de l'onglet Applications.
              </p>

              <div className="guide-steps">
                <div className="guide-step"><span className="guide-step-num">1</span> Créez une Application dans l'onglet <strong>Applications</strong> et copiez son secret.</div>
                <div className="guide-step"><span className="guide-step-num">2</span> Générez des clés pour cette application dans l'onglet <strong>Clés de Licence</strong>.</div>
                <div className="guide-step"><span className="guide-step-num">3</span> Intégrez l'extrait de code en haut de votre script.</div>
                <div className="guide-step"><span className="guide-step-num">4</span> Distribuez les clés à vos utilisateurs — les connexions apparaissent dans <strong>Logs d'Accès</strong>.</div>
              </div>
            </div>

            <div className="glass-card">
              <div className="flex-space" style={{ marginBottom: '0.75rem' }}>
                <h3 style={{ margin: 0 }}>🐍 Python Client</h3>
                <CopyBtn text={`# pip install requests\nimport requests, hashlib, uuid\n\nAPI_URL = "http://localhost:5000/api/client"\nAPP_NAME = "YOUR_APP_NAME"\nAPP_SECRET = "YOUR_APP_SECRET"\n\ndef authenticate(key):\n    init_res = requests.post(f"{API_URL}/init", json={"app_name": APP_NAME, "secret": APP_SECRET}).json()\n    if not init_res.get("success"):\n        raise Exception("Handshake failed: " + init_res.get("message"))\n    session_id = init_res["session_id"]\n    hwid = hashlib.sha256(str(uuid.getnode()).encode()).hexdigest()\n    login_res = requests.post(f"{API_URL}/login", json={"session_id": session_id, "key": key, "hwid": hwid}).json()\n    if not login_res.get("success"):\n        raise Exception("Auth failed: " + login_res.get("message"))\n    return session_id`} />
              </div>
              <div className="code-preview">
{`# pip install requests
import requests, hashlib, uuid

API_URL    = "http://localhost:5000/api/client"
APP_NAME   = "YOUR_APP_NAME"
APP_SECRET = "YOUR_APP_SECRET"

def authenticate(key):
    # 1. Handshake
    init_res = requests.post(f"{API_URL}/init", json={
        "app_name": APP_NAME, "secret": APP_SECRET
    }).json()
    if not init_res.get("success"):
        raise Exception("Handshake failed: " + init_res.get("message"))

    session_id = init_res["session_id"]
    hwid = hashlib.sha256(str(uuid.getnode()).encode()).hexdigest()

    # 2. Login with key
    login_res = requests.post(f"{API_URL}/login", json={
        "session_id": session_id, "key": key, "hwid": hwid
    }).json()
    if not login_res.get("success"):
        raise Exception("Auth failed: " + login_res.get("message"))

    return session_id   # Use this session_id for /var calls

# Usage
session = authenticate(input("Enter your license key: "))
print("✓ Authenticated successfully!")`}
              </div>
            </div>

            <div className="glass-card">
              <div className="flex-space" style={{ marginBottom: '0.75rem' }}>
                <h3 style={{ margin: 0 }}>⬡ Node.js Client</h3>
                <CopyBtn text={`const API_URL = "http://localhost:5000/api/client";\nconst APP_NAME = "YOUR_APP_NAME";\nconst APP_SECRET = "YOUR_APP_SECRET";\n\nasync function verifyLicense(licenseKey) {\n  const init = await fetch(\`\${API_URL}/init\`, {\n    method: 'POST',\n    headers: { 'Content-Type': 'application/json' },\n    body: JSON.stringify({ app_name: APP_NAME, secret: APP_SECRET })\n  }).then(r => r.json());\n  if (!init.success) throw new Error(init.message);\n\n  const auth = await fetch(\`\${API_URL}/login\`, {\n    method: 'POST',\n    headers: { 'Content-Type': 'application/json' },\n    body: JSON.stringify({ session_id: init.session_id, key: licenseKey, hwid: 'your-hwid' })\n  }).then(r => r.json());\n  if (!auth.success) throw new Error(auth.message);\n  return init.session_id;\n}`} />
              </div>
              <div className="code-preview">
{`const API_URL    = "http://localhost:5000/api/client";
const APP_NAME   = "YOUR_APP_NAME";
const APP_SECRET = "YOUR_APP_SECRET";

async function verifyLicense(licenseKey) {
  // 1. Handshake
  const init = await fetch(\`\${API_URL}/init\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_name: APP_NAME, secret: APP_SECRET })
  }).then(r => r.json());
  if (!init.success) throw new Error(init.message);

  // 2. Authenticate
  const auth = await fetch(\`\${API_URL}/login\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: init.session_id,
      key: licenseKey,
      hwid: require('os').networkInterfaces()?.lo?.[0]?.mac || 'default'
    })
  }).then(r => r.json());
  if (!auth.success) throw new Error(auth.message);

  return init.session_id; // reuse for /var requests
}

verifyLicense(process.argv[2]).then(sid => console.log("✓ Auth OK, session:", sid));`}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
