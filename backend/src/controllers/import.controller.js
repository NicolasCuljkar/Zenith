'use strict';

const Anthropic = require('@anthropic-ai/sdk');

const VALID_CATS   = ['revenu', 'impot', 'fixe', 'variable', 'epargne', 'loisir'];
const VALID_MONTHS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

async function analyzePhoto(req, res, next) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ success: false, error: 'Analyse photo non disponible (clé ANTHROPIC_API_KEY manquante dans les variables Railway).' });
    }

    const { imageBase64, mimeType } = req.body;
    if (!imageBase64 || !mimeType) {
      return res.status(400).json({ success: false, error: 'Image requise (imageBase64 + mimeType).' });
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mimeType, data: imageBase64 },
          },
          {
            type: 'text',
            text: `Analyse cette image et extrait les données budgétaires. Retourne UNIQUEMENT un JSON valide avec ce format exact :
{"entries":[{"name":"Salaire","amount":3000,"cat":"revenu","member":"Nicolas"}],"savings":[{"member":"Nicolas","year":2024,"month":"Janvier","amount":15000}]}

Règles strictes :
- cat doit être exactement l'un de : revenu, impot, fixe, variable, epargne, loisir
- member doit être exactement l'un de : Nicolas, Carla, Commun
- amount : nombre positif (revenus, épargne), négatif (dépenses, impôts)
- month en français : Janvier, Février, Mars, Avril, Mai, Juin, Juillet, Août, Septembre, Octobre, Novembre, Décembre
- Si aucune donnée trouvée : {"entries":[],"savings":[]}
- Retourne UNIQUEMENT le JSON brut, rien d'autre`,
          },
        ],
      }],
    });

    const text = message.content[0].text.trim();
    let data;
    try {
      const match = text.match(/\{[\s\S]*\}/);
      data = JSON.parse(match ? match[0] : text);
    } catch {
      return res.status(422).json({ success: false, error: "Impossible d'extraire les données de l'image. Essayez avec une image plus lisible." });
    }

    if (!Array.isArray(data.entries)) data.entries = [];
    if (!Array.isArray(data.savings)) data.savings = [];

    // Sanitize
    data.entries = data.entries
      .filter(e => e.name && VALID_CATS.includes(e.cat))
      .map(e => ({ name: String(e.name), amount: Number(e.amount) || 0, cat: e.cat, member: e.member || 'Commun' }));

    data.savings = data.savings
      .filter(s => s.member && VALID_MONTHS.includes(s.month) && s.year)
      .map(s => ({ member: String(s.member), year: Number(s.year), month: s.month, amount: Number(s.amount) || 0 }));

    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

module.exports = { analyzePhoto };
