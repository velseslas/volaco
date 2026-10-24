// Lance les 4 générations via Gemini (clé valide de la grille)
const fs = require('node:fs');
(async () => {
  const stored = JSON.parse(fs.readFileSync('.volaco-data/ai-provider-keys.json', 'utf8')).keys || {};
  const gkey = (stored.gemini && (stored.gemini.apiKey || stored.gemini)) || '';
  process.env.GEMINI_API_KEY = gkey;
  process.env.MISTRAL_API_KEY = ''; // la clé mistral .env est révoquée : ne doit pas gagner
  process.env.GEMINI_MODEL = 'gemini-2.5-flash';
  process.env.VOLACO_EXECUTION_TIMELINE = 'off';
  await import('./mission-generations.cjs');
})().catch((e) => { console.error(e); process.exit(1); });
