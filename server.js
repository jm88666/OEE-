require('dotenv').config();

const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3131;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const REPORT_RETENTION_DAYS = parseInt(process.env.REPORT_RETENTION_DAYS || '30', 10);
const SESSION_DAYS = parseInt(process.env.SESSION_DAYS || '14', 10);
const AUTH_ENV_NAMES = [
  'LOGIN_PASSWORD',
  'LOGIN_WACHTWOORD',
  'LOGINWACHTWOORD',
  'PASSWORD',
  'WACHTWOORD',
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
    || (key.includes('LOGIN') && (key.includes('PASSWORD') || key.includes('WACHTWOORD')))
    || (key.includes('JM') && key.includes('ANALYZE'))
    || key === 'PASSWORD'
    || key === 'WACHTWOORD';
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
  return users.find(u => u.id === session.userId && u.active !== false) || null;
}
function requireUser(req, res, next) {
  const user = sessionUser(req);
  if (!user) return res.status(401).json({ error: 'Niet ingelogd.' });
  req.user = user;
  next();
}
function requireAdmin(req, res, next) {
  requireUser(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Geen beheerrechten.' });
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
      '<script src="/report-storage.js"></script>',
      '<script src="/analysis-layer.js"></script>',
      '<script src="/demo-scenarios.js"></script>',
    ]);
    res.type('html').send(page);
  });
};

app.use(express.json({ limit: '50mb' }));

app.get(['/', '/index.html'], (req, res, next) => sendFile(res, next, 'login.html'));
app.get(['/report', '/reports', '/jm-report', '/basic-report', '/complete-report'], (req, res, next) => sendReportBuilder(res, next));
app.get(['/my-reports', '/reports-library'], (req, res, next) => sendFile(res, next, 'reports.html'));
app.get(['/admin', '/beheer'], (req, res, next) => sendFile(res, next, 'admin.html'));

app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/auth/register', (req, res) => {
  const { email, password, inviteCode, name, location } = req.body || {};
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanName = String(name || '').trim();
  const codes = inviteCodes();
  if (!codes.length) return res.status(503).json({ error: 'Accountcode is nog niet ingesteld.' });
  if (!codes.includes(String(inviteCode || '').trim())) return res.status(403).json({ error: 'Accountcode is ongeldig.' });
  if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) return res.status(400).json({ error: 'Vul een geldig e-mailadres in.' });
  if (String(password || '').length < 8) return res.status(400).json({ error: 'Wachtwoord moet minimaal 8 tekens zijn.' });

  const users = readJson('users.json', []);
  if (users.some(u => u.email === cleanEmail)) return res.status(409).json({ error: 'Dit account bestaat al.' });
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
  const users = readJson('users.json', []);
  const user = users.find(u => u.email === cleanEmail && u.active !== false);
  if (!user || !verifyPassword(password, user.passwordHash)) return res.status(401).json({ error: 'E-mail of wachtwoord onjuist.' });
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const sessions = readJson('sessions.json', []).filter(s => new Date(s.expiresAt).getTime() > Date.now());
  sessions.push({ token, userId: user.id, createdAt: nowIso(), expiresAt });
  writeJson('sessions.json', sessions);
  audit('login', user);
  res.json({ token, user: publicUser(user), expiresAt });
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

app.post('/api/analyze', requireUser, async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === 'plak-hier-je-sleutel') {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY niet ingesteld in .env bestand.' });
  }
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Geen prompt meegegeven.' });
  audit('ai_report_generated', req.user, { promptChars: String(prompt).length });

  try {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 8000,
      system: 'Je bent expert productie-analist voor industriele snijmachines. Retourneer UITSLUITEND valide JSON zonder markdown.',
      messages: [{ role: 'user', content: prompt }]
    });
    res.json({ text: message.content[0].text });
  } catch (err) {
    console.error('Anthropic API fout:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/extract-image', requireUser, async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === 'plak-hier-je-sleutel') {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY niet ingesteld.' });
  }
  const { imageBase64, mimeType } = req.body;
  if (!imageBase64 || !mimeType) return res.status(400).json({ error: 'Geen afbeelding meegegeven.' });
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
            text: `Extraheer alle getallen uit dit PROMs OEE Detail Rapport.
Retourneer ALLEEN dit JSON zonder markdown of uitleg:
{
  "oee": 0, "nt_rate": 0, "pl_rate": 0,
  "handling_rate": 0, "speed_factor": 0,
  "not_scheduled_min": 0, "planned_min": 0,
  "op_down_min": 0, "run_factor": 0,
  "no_sluis_factor": 0, "norun_min": 0,
  "sluis_min": 0,
  "stilstand": [
    {"cat":"", "omschrijving":"", "aantal":0, "duur_min":0, "pct":0}
  ]
}`
          }
        ]
      }]
    });
    const text = message.content.find(c => c.type === 'text')?.text || '';
    res.json({ text });
  } catch (err) {
    console.error('Vision API fout:', err.message);
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
  if (!String(title || '').trim()) return res.status(400).json({ error: 'Rapporttitel ontbreekt.' });
  if (!String(html || '').trim()) return res.status(400).json({ error: 'Rapportinhoud ontbreekt.' });
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
  if (!report) return res.status(404).json({ error: 'Rapport niet gevonden.' });
  if (req.user.role !== 'admin' && report.userId !== req.user.id) return res.status(403).json({ error: 'Geen toegang tot dit rapport.' });
  res.json({ report });
});

app.delete('/api/reports/:id', requireUser, (req, res) => {
  const reports = readJson('reports.json', []);
  const report = reports.find(r => r.id === req.params.id);
  if (!report) return res.status(404).json({ error: 'Rapport niet gevonden.' });
  if (req.user.role !== 'admin' && report.userId !== req.user.id) return res.status(403).json({ error: 'Geen toegang tot dit rapport.' });
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
  if (!user) return res.status(404).json({ error: 'Gebruiker niet gevonden.' });
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

app.listen(PORT, () => console.log(`JMAnalyzeTool draait op http://localhost:${PORT}`));
