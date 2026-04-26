require('dotenv').config();

const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3131;
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
const sendFile = (res, next, fileName) => {
  res.sendFile(path.join(__dirname, 'public', fileName), err => { if (err) next(err); });
};

app.use(express.json({ limit: '20mb' }));

app.get(['/', '/index.html'], (req, res, next) => sendFile(res, next, 'login.html'));
app.get(['/report', '/reports', '/jm-report', '/basic-report', '/complete-report'], (req, res, next) => sendFile(res, next, 'jm-report.html'));

app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/analyze', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === 'plak-hier-je-sleutel') {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY niet ingesteld in .env bestand.' });
  }
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Geen prompt meegegeven.' });

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

app.post('/api/extract-image', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === 'plak-hier-je-sleutel') {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY niet ingesteld.' });
  }
  const { imageBase64, mimeType } = req.body;
  if (!imageBase64 || !mimeType) return res.status(400).json({ error: 'Geen afbeelding meegegeven.' });

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

app.get('/api/auth-check', (req, res) => {
  const { pass } = req.query;
  const authSecrets = getAuthSecrets();
  const submittedPass = String(pass || '');
  const validPass = authSecrets.some(secret => submittedPass === secret);
  res.json({ ok: validPass, configured: authSecrets.length > 0 });
});

app.listen(PORT, () => console.log(`JMAnalyzeTool draait op http://localhost:${PORT}`));
