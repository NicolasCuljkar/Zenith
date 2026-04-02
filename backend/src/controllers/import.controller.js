'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const entriesService = require('../services/entries.service');

const VALID_CATS   = ['revenu', 'impot', 'fixe', 'variable', 'epargne', 'loisir'];
const VALID_MONTHS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

const CAT_LABELS = {
  revenu: 'Revenu', impot: 'Impôt', fixe: 'Fixe',
  variable: 'Variable', epargne: 'Épargne', loisir: 'Loisir',
};

function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    const err = new Error('ANTHROPIC_API_KEY manquante — configurez-la dans les variables Railway.');
    err.statusCode = 503;
    throw err;
  }
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// ── Analyse photo ─────────────────────────────────────────────────────────────

async function analyzePhoto(req, res, next) {
  try {
    const client = getClient();
    const { imageBase64, mimeType } = req.body;
    if (!imageBase64 || !mimeType) {
      return res.status(400).json({ success: false, error: 'Image requise (imageBase64 + mimeType).' });
    }

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } },
          {
            type: 'text',
            text: `Analyse cette image et extrait les données budgétaires. Retourne UNIQUEMENT un JSON valide :
{"entries":[{"name":"Salaire","amount":3000,"cat":"revenu","member":"Nicolas"}],"savings":[{"member":"Nicolas","year":2024,"month":"Janvier","amount":15000}]}
Règles : cat ∈ {revenu,impot,fixe,variable,epargne,loisir} · amount positif=revenu/épargne, négatif=dépense · Retourne UNIQUEMENT le JSON.`,
          },
        ],
      }],
    });

    const text = message.content[0].text.trim();
    let data;
    try { const m = text.match(/\{[\s\S]*\}/); data = JSON.parse(m ? m[0] : text); }
    catch { return res.status(422).json({ success: false, error: "Impossible d'extraire les données de l'image." }); }

    if (!Array.isArray(data.entries)) data.entries = [];
    if (!Array.isArray(data.savings)) data.savings = [];
    data.entries = data.entries.filter(e => e.name && VALID_CATS.includes(e.cat))
      .map(e => ({ name: String(e.name), amount: Number(e.amount) || 0, cat: e.cat, member: e.member || 'Commun' }));
    data.savings = data.savings.filter(s => s.member && VALID_MONTHS.includes(s.month) && s.year)
      .map(s => ({ member: String(s.member), year: Number(s.year), month: s.month, amount: Number(s.amount) || 0 }));

    res.json({ success: true, data });
  } catch (err) { next(err); }
}

// ── Analyse CSV/texte relevé bancaire ────────────────────────────────────────

async function analyzeCSV(req, res, next) {
  try {
    const client = getClient();
    const { csvContent, member } = req.body;
    if (!csvContent) return res.status(400).json({ success: false, error: 'csvContent requis.' });

    const safeContent = String(csvContent).slice(0, 12000);
    const defaultMember = member || 'Commun';

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: `Tu es un expert en finances personnelles françaises. Analyse ce relevé bancaire et catégorise chaque transaction.

MEMBRE : ${defaultMember}

CATÉGORIES (utilise exactement ces valeurs) :
- revenu   → salaire, virement entrant, remboursement, allocation, prime, pension
- impot    → impôt sur le revenu, taxe foncière/habitation, prélèvements fiscaux CSG/CRDS
- fixe     → loyer, électricité/gaz/eau, assurance, téléphone/internet, abonnements récurrents, crédit immobilier/auto, mutuelle santé
- variable → courses alimentaires (supermarché, épicerie), essence/carburant, pharmacie, transports (RATP, SNCF), entretien courant
- epargne  → virement vers livret/PEL/CEL/PEA, assurance-vie, placement, investissement
- loisir   → restaurants/bars/cafés, cinéma/spectacles/culture, voyages/hôtels/airbnb, sport/fitness, shopping vêtements/tech, streaming (Netflix/Spotify/Disney+), jeux

RÈGLES IMPORTANTES :
1. amount : positif = crédit/revenu entrant, négatif = débit/dépense
2. Ignore les virements internes entre propres comptes
3. Regroupe les lignes identiques répétées (ex: 3× Netflix → 1 ligne "Netflix" avec montant mensuel)
4. Pour transactions ambiguës → "variable"
5. Retourne UNIQUEMENT le JSON brut, zéro texte autour, zéro markdown

FORMAT DE RÉPONSE :
{"entries":[{"name":"Salaire","amount":3200,"cat":"revenu","member":"${defaultMember}"},{"name":"Loyer","amount":-850,"cat":"fixe","member":"${defaultMember}"},{"name":"Courses Carrefour","amount":-320,"cat":"variable","member":"${defaultMember}"}]}

RELEVÉ BANCAIRE :
${safeContent}`,
      }],
    });

    const text = message.content[0].text.trim();
    let entries;
    try {
      const match = text.match(/\{[\s\S]*\}/);
      const data = JSON.parse(match ? match[0] : text);
      entries = Array.isArray(data.entries) ? data.entries : [];
    } catch {
      return res.status(422).json({ success: false, error: "Impossible d'analyser le fichier. Vérifiez que le format est bien CSV." });
    }

    entries = entries
      .filter(e => e.name && VALID_CATS.includes(e.cat))
      .map(e => ({
        name: String(e.name).trim(),
        amount: Number(e.amount) || 0,
        cat: e.cat,
        member: String(e.member || defaultMember),
      }));

    res.json({ success: true, data: entries });
  } catch (err) { next(err); }
}

// ── Confirmation import → sauvegarde en DB ────────────────────────────────────

async function confirmImport(req, res, next) {
  try {
    const { entries } = req.body;
    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ success: false, error: 'Aucune entrée à importer.' });
    }

    let saved = 0;
    const failed = [];
    for (const e of entries) {
      try {
        entriesService.create({ name: e.name, amount: e.amount, cat: e.cat, member: e.member }, req.user.id);
        saved++;
      } catch (err) {
        failed.push(e.name);
      }
    }

    res.json({ success: true, data: { saved, failed } });
  } catch (err) { next(err); }
}

module.exports = { analyzePhoto, analyzeCSV, confirmImport };
