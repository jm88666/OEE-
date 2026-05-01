require('dotenv').config();

const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3131;
const DEFAULT_DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'data')
  : path.join(__dirname, 'data');
const DATA_DIR = process.env.DATA_DIR || DEFAULT_DATA_DIR;
const REPORT_RETENTION_DAYS = parseInt(process.env.REPORT_RETENTION_DAYS || '30', 10);
const SESSION_DAYS = parseInt(process.env.SESSION_DAYS || '14', 10);
const AUTH_ENV_NAMES = [
  'LOGIN_PASSWORD',
  'PASSWORD',
  'JM_ANALYZE_TOOL',
  'JM_ANALYZE_TOOL_PASSWORD',
  'JMANALYZETOOL',
  'JMAnalyzeTool',
  'JM_PASSWORD',
  'JM_TOOL_PASSWORD',
  'OEE_AUTH_SECRET',
];

const normalizeEnvName = name => String(name || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
const AUTH_ENV_KEYS = new Set(AUTH_ENV_NAMES.map(normalizeEnvName));
const looksLikeAuthEnv = name => {
  const key = normalizeEnvName(name);
  return AUTH_ENV_KEYS.has(key)
    || (key.includes('LOGIN') && key.includes('PASSWORD'))
    || (key.includes('JM') && key.includes('ANALYZE'))
    || key === 'PASSWORD';
};
const getAuthSecrets = () => [...new Set(Object.entries(process.env)
  .filter(([name, value]) => value && looksLikeAuthEnv(name))
  .map(([, value]) => String(value)))];
const inviteCodes = () => [
  process.env.ACCOUNT_INVITE_CODE,
  process.env.JM_INVITE_CODE,
  process.env.INVITE_CODE,
  ...(process.env.ACCOUNT_INVITE_CODES || '').split(',')
].map(v => String(v || '').trim()).filter(Boolean);
const adminEmails = () => (process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || '')
  .split(',')
  .map(v => v.trim().toLowerCase())
  .filter(Boolean);
const splitList = value => String(value || '')
  .split(/[,;\n\r]+/)
  .map(v => v.trim().toLowerCase())
  .filter(Boolean);
const allowedEmails = () => splitList(process.env.ALLOWED_EMAILS || process.env.ALLOWED_EMAIL || '');
const emailAllowed = email => {
  const list = [...new Set([...allowedEmails(), ...adminEmails()])];
  if (list.length) return list.includes(String(email || '').trim().toLowerCase());
  return process.env.ALLOW_ALL_EMAILS === 'true' && !process.env.RAILWAY_ENVIRONMENT_ID;
};
const maskEmail = email => {
  const [name, domain] = String(email || '').split('@');
  if (!name || !domain) return '';
  return `${name.slice(0, 2)}***${name.slice(-2)}@${domain}`;
};

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
function filePath(name) {
  ensureDataDir();
  return path.join(DATA_DIR, name);
}
function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath(name), 'utf8'));
  } catch (_) {
    return fallback;
  }
}
function writeJson(name, value) {
  const target = filePath(name);
  fs.writeFileSync(`${target}.tmp`, JSON.stringify(value, null, 2));
  fs.renameSync(`${target}.tmp`, target);
}
function revokeSessionsForUser(userId) {
  if (!userId) return;
  const sessions = readJson('sessions.json', []);
  const kept = sessions.filter(s => s.userId !== userId);
  if (kept.length !== sessions.length) writeJson('sessions.json', kept);
}
function revokeSessionsForEmail(email) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!cleanEmail) return;
  const user = readJson('users.json', []).find(u => u.email === cleanEmail);
  if (user) revokeSessionsForUser(user.id);
}
function nowIso() {
  return new Date().toISOString();
}
function id(prefix) {
  return `${prefix}_${crypto.randomBytes(12).toString('hex')}`;
}
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 32, 'sha256').toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const candidate = hashPassword(password, salt).split(':')[1];
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(candidate));
}
function publicUser(user) {
  if (!user) return null;
  const { passwordHash, ...safe } = user;
  return safe;
}
function audit(type, user, details = {}) {
  const logs = readJson('audit.json', []);
  logs.unshift({ id: id('evt'), type, userId: user?.id || null, email: user?.email || null, at: nowIso(), details });
  writeJson('audit.json', logs.slice(0, 2000));
}
function cleanupReports() {
  const reports = readJson('reports.json', []);
  const cutoff = Date.now() - REPORT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const kept = reports.filter(r => new Date(r.createdAt).getTime() >= cutoff);
  if (kept.length !== reports.length) writeJson('reports.json', kept);
}
function sessionUser(req) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return null;
  const sessions = readJson('sessions.json', []);
  const session = sessions.find(s => s.token === token && new Date(s.expiresAt).getTime() > Date.now());
  if (!session) return null;
  const users = readJson('users.json', []);
  const user = users.find(u => u.id === session.userId && u.active !== false) || null;
  if (!user) return null;
  if (!emailAllowed(user.email)) {
    revokeSessionsForUser(user.id);
    return null;
  }
  return user;
}
function requireUser(req, res, next) {
  const user = sessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not signed in.' });
  req.user = user;
  next();
}
function requireAdmin(req, res, next) {
  requireUser(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin permissions required.' });
    next();
  });
}
const sendFile = (res, next, fileName) => {
  res.sendFile(path.join(__dirname, 'public', fileName), err => { if (err) next(err); });
};
const injectScripts = (html, tags) => tags.reduce((body, tag) => body.includes(tag) ? body : body.replace('</body>', `${tag}\n</body>`), html);
const sendReportBuilder = (res, next) => {
  const reportPath = path.join(__dirname, 'public', 'jm-report.html');
  fs.readFile(reportPath, 'utf8', (err, html) => {
    if (err) return next(err);
    const page = injectScripts(html, [
      '<script src="/auth-client.js"></script>',
      '<script src="/demo-scenarios.js"></script>',
    ]);
    res.type('html').send(page);
  });
};

app.use(express.json({ limit: '50mb' }));

app.get(['/', '/index.html'], (req, res, next) => sendFile(res, next, 'login.html'));
app.get(['/report', '/reports', '/jm-report', '/basic-report', '/complete-report'], (req, res, next) => sendReportBuilder(res, next));
app.get(['/my-reports', '/reports-library'], (req, res, next) => sendFile(res, next, 'reports.html'));
app.get('/admin', (req, res, next) => sendFile(res, next, 'admin.html'));

app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/auth/register', (req, res) => {
  const { email, password, inviteCode, name, location } = req.body || {};
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanName = String(name || '').trim();
  const codes = inviteCodes();
  if (!codes.length) return res.status(503).json({ error: 'Account code is not configured yet.' });
  if (!codes.includes(String(inviteCode || '').trim())) return res.status(403).json({ error: 'Account code is invalid.' });
  if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (!emailAllowed(cleanEmail)) return res.status(403).json({ error: 'This email is not allowed to create an account.' });
  if (String(password || '').length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  const users = readJson('users.json', []);
  if (users.some(u => u.email === cleanEmail)) return res.status(409).json({ error: 'This account already exists.' });
  const firstUser = users.length === 0;
  const role = firstUser || adminEmails().includes(cleanEmail) ? 'admin' : 'user';
  const user = {
    id: id('usr'),
    email: cleanEmail,
    name: cleanName || cleanEmail,
    location: String(location || '').trim(),
    role,
    active: true,
    createdAt: nowIso(),
    passwordHash: hashPassword(password),
  };
  users.push(user);
  writeJson('users.json', users);
  audit('account_created', user, { role, location: user.location });
  res.status(201).json({ user: publicUser(user) });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!emailAllowed(cleanEmail)) {
    revokeSessionsForEmail(cleanEmail);
    return res.status(401).json({ error: 'Email or password is incorrect.' });
  }
  const users = readJson('users.json', []);
  const user = users.find(u => u.email === cleanEmail && u.active !== false);
  if (!user || !verifyPassword(password, user.passwordHash)) return res.status(401).json({ error: 'Email or password is incorrect.' });
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const sessions = readJson('sessions.json', []).filter(s => new Date(s.expiresAt).getTime() > Date.now());
  sessions.push({ token, userId: user.id, createdAt: nowIso(), expiresAt });
  writeJson('sessions.json', sessions);
  audit('login', user);
  res.json({ token, user: publicUser(user), expiresAt });
});

app.post('/api/auth/reset-password', (req, res) => {
  const { email, password, inviteCode } = req.body || {};
  const cleanEmail = String(email || '').trim().toLowerCase();
  const codes = inviteCodes();
  if (!codes.length) return res.status(503).json({ error: 'Account code is not configured yet.' });
  if (!codes.includes(String(inviteCode || '').trim())) return res.status(403).json({ error: 'Account code is invalid.' });
  if (!emailAllowed(cleanEmail)) return res.status(403).json({ error: 'This email is not allowed to reset a password.' });
  if (String(password || '').length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  const users = readJson('users.json', []);
  let user = users.find(u => u.email === cleanEmail && u.active !== false);
  if (!user) {
    const role = users.length === 0 || adminEmails().includes(cleanEmail) ? 'admin' : 'user';
    user = {
      id: id('usr'),
      email: cleanEmail,
      name: cleanEmail,
      location: '',
      role,
      active: true,
      createdAt: nowIso(),
      passwordHash: hashPassword(password),
    };
    users.push(user);
    writeJson('users.json', users);
    audit('account_created_from_reset', user, { role });
    return res.json({ ok: true, created: true, user: publicUser(user) });
  }
  user.passwordHash = hashPassword(password);
  writeJson('users.json', users);
  revokeSessionsForUser(user.id);
  audit('password_reset', user);
  res.json({ ok: true });
});

app.post('/api/auth/logout', requireUser, (req, res) => {
  const token = (req.get('authorization') || '').replace(/^Bearer\s+/, '');
  writeJson('sessions.json', readJson('sessions.json', []).filter(s => s.token !== token));
  audit('logout', req.user);
  res.json({ ok: true });
});

app.get('/api/auth/me', requireUser, (req, res) => {
  res.json({ user: publicUser(req.user), retentionDays: REPORT_RETENTION_DAYS });
});

app.get('/api/auth/allowed-check', (req, res) => {
  const email = String(req.query.email || '').trim().toLowerCase();
  const list = [...new Set([...allowedEmails(), ...adminEmails()])];
  res.json({
    email,
    allowed: emailAllowed(email),
    allowedCount: list.length,
    allowedMasked: list.map(maskEmail),
  });
});

app.post('/api/analyze', requireUser, async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === 'plak-hier-je-sleutel' || apiKey === 'paste-your-key-here') {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured.' });
  }
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Missing prompt.' });
  audit('ai_report_generated', req.user, { promptChars: String(prompt).length });

  try {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 8000,
      system: 'You are an expert production analyst for industrial cutting machines. Return valid JSON only, without markdown.',
      messages: [{ role: 'user', content: prompt }]
    });
    res.json({ text: message.content[0].text });
  } catch (err) {
    console.error('Anthropic API error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/extract-image', requireUser, async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === 'plak-hier-je-sleutel' || apiKey === 'paste-your-key-here') {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured.' });
  }
  const { imageBase64, mimeType } = req.body;
  if (!imageBase64 || !mimeType) return res.status(400).json({ error: 'Missing image.' });
  audit('image_extract_used', req.user);

  try {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mimeType, data: imageBase64 }
          },
          {
            type: 'text',
            text: `Extract all numbers from this PROMs OEE Detail Report.
Return only this JSON without markdown or explanation:
{
  "oee": 0, "nt_rate": 0, "pl_rate": 0,
  "handling_rate": 0, "speed_factor": 0,
  "not_scheduled_min": 0, "planned_min": 0,
  "op_down_min": 0, "run_factor": 0,
  "no_sluis_factor": 0, "norun_min": 0,
  "sluis_min": 0,
  "downtime": [
    {"cat":"", "description":"", "count":0, "duration_min":0, "pct":0}
  ]
}`
          }
        ]
      }]
    });
    const text = message.content.find(c => c.type === 'text')?.text || '';
    res.json({ text });
  } catch (err) {
    console.error('Vision API error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/reports', requireUser, (req, res) => {
  cleanupReports();
  const reports = readJson('reports.json', []);
  const visible = req.user.role === 'admin' ? reports : reports.filter(r => r.userId === req.user.id);
  res.json({ reports: visible.map(({ html, ...meta }) => meta), retentionDays: REPORT_RETENTION_DAYS });
});

app.post('/api/reports', requireUser, (req, res) => {
  cleanupReports();
  const { title, machine, shift, route, sources, html, summary } = req.body || {};
  if (!String(title || '').trim()) return res.status(400).json({ error: 'Report title is missing.' });
  if (!String(html || '').trim()) return res.status(400).json({ error: 'Report content is missing.' });
  const report = {
    id: id('rpt'),
    title: String(title).trim().slice(0, 120),
    machine: String(machine || '').trim().slice(0, 80),
    shift: String(shift || '').trim().slice(0, 80),
    route: String(route || '').trim().slice(0, 80),
    sources: Array.isArray(sources) ? sources.slice(0, 10) : [],
    summary: String(summary || '').trim().slice(0, 500),
    html: String(html).slice(0, 2_000_000),
    userId: req.user.id,
    email: req.user.email,
    userName: req.user.name,
    location: req.user.location || '',
    createdAt: nowIso(),
    expiresAt: new Date(Date.now() + REPORT_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString(),
  };
  const reports = readJson('reports.json', []);
  reports.unshift(report);
  writeJson('reports.json', reports.slice(0, 1000));
  audit('report_saved', req.user, { reportId: report.id, title: report.title, route: report.route, sources: report.sources });
  const { html: _, ...meta } = report;
  res.status(201).json({ report: meta });
});

app.get('/api/reports/:id', requireUser, (req, res) => {
  cleanupReports();
  const report = readJson('reports.json', []).find(r => r.id === req.params.id);
  if (!report) return res.status(404).json({ error: 'Report not found.' });
  if (req.user.role !== 'admin' && report.userId !== req.user.id) return res.status(403).json({ error: 'No access to this report.' });
  res.json({ report });
});

app.delete('/api/reports/:id', requireUser, (req, res) => {
  const reports = readJson('reports.json', []);
  const report = reports.find(r => r.id === req.params.id);
  if (!report) return res.status(404).json({ error: 'Report not found.' });
  if (req.user.role !== 'admin' && report.userId !== req.user.id) return res.status(403).json({ error: 'No access to this report.' });
  writeJson('reports.json', reports.filter(r => r.id !== req.params.id));
  audit('report_deleted', req.user, { reportId: report.id, title: report.title });
  res.json({ ok: true });
});

app.get('/api/admin/users', requireAdmin, (req, res) => {
  res.json({ users: readJson('users.json', []).map(publicUser) });
});

app.get('/api/admin/audit', requireAdmin, (req, res) => {
  res.json({ audit: readJson('audit.json', []).slice(0, 300) });
});

app.patch('/api/admin/users/:id', requireAdmin, (req, res) => {
  const users = readJson('users.json', []);
  const user = users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (typeof req.body.active === 'boolean') user.active = req.body.active;
  if (req.body.role && ['admin', 'user'].includes(req.body.role)) user.role = req.body.role;
  writeJson('users.json', users);
  audit('user_updated', req.user, { targetUserId: user.id, active: user.active, role: user.role });
  res.json({ user: publicUser(user) });
});

app.get('/api/auth-check', (req, res) => {
  const { pass } = req.query;
  const authSecrets = getAuthSecrets();
  const submittedPass = String(pass || '');
  const validPass = authSecrets.some(secret => submittedPass === secret);
  res.json({ ok: validPass, configured: authSecrets.length > 0 });
});

app.listen(PORT, () => {
  console.log(`JMAnalyzeTool running at http://localhost:${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
  console.log(`Allowed emails configured: ${new Set([...allowedEmails(), ...adminEmails()]).size}`);
});
