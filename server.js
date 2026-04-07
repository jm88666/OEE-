require('dotenv').config();

const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3131;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/analyze', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === 'plak-hier-je-sleutel') {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY niet ingesteld in .env bestand.' });
  }

  const { prompt } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: 'Geen prompt meegegeven.' });
  }

  try {
    const client = new Anthropic({ apiKey });

    const message = await client.messages.create({
      model: 'claude-sonnet-4-5-20251001',
      max_tokens: 6000,
      system: 'Je bent een expert productie-analist voor industriële snijmachines. Retourneer UITSLUITEND valide JSON zonder markdown.',
      messages: [
        { role: 'user', content: prompt }
      ]
    });

    const text = message.content[0].text;
    res.json({ text });
  } catch (err) {
    console.error('Anthropic API fout:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`OEE Analyse server draait op http://localhost:${PORT}`);
});
