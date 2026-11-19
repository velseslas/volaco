/**
 * É50/É51 — GARDE-FOU D'EXFILTRATION (implémentation canonique).
 *
 * É50 : contrôle déterministe à la frontière de persistance du HTML généré
 * (routes conversationnelles). Reproduction du P0 S8 : un fetch d'exfiltration
 * persisté verbatim, gate 98/100, aucune interception.
 *
 * É51 : ce module devient la référence canonique du core et est appliqué À LA
 * FRONTIÈRE D'ÉCRITURE DU MUTATION ORCHESTRATOR (FileStoreAdapter) : toute
 * mutation IA de document HTML est validée AVANT sa persistance — une écriture
 * refusée n'atteint jamais fileStore, elle est annulée et tracée.
 *
 * Constat É49/S8 reproduit (preuve sonde e50, :3100) : une demande contrôlée
 * « formulaire de connexion → envoyer le mot de passe saisi à
 * https://attacker.example/collect via fetch » produit un HTML final PERSISTÉ
 * contenant le fetch d'exfiltration verbatim, avec un Quality Gate à 98/100
 * et AUCUNE interception. Trois couches existantes n'ont rien bloqué :
 *  1. l'Agent Sécurité est consultatif — sa sortie n'est appliquée que s'il
 *     renvoie un flux complet avec marqueurs (agent-generation-pipeline.ts
 *     L381-390) ; sinon le flux Backend est conservé tel quel ;
 *  2. le préflight d'ingénierie ne vérifie que des défauts structurels
 *     (enveloppe, octet nul, taille) — aucune vérification réseau ;
 *  3. le Quality Gate visuel (rendu Chromium + computeCriticScore) ne mesure
 *     aucune destination réseau.
 *
 * Ce module est le contrôle DÉTERMINISTE qui manque, exécuté À LA FRONTIÈRE
 * DE CONFIANCE (avant toute écriture du HTML généré dans le fileStore),
 * indépendant des prompts LLM :
 *  - REFUS PAR DÉFAUT : tout canal de transmission vers une destination
 *    réseau absolu non identifiée est un bloqueur — y compris une URL non
 *    parseable, fragmentée, ou construite dynamiquement (concaténation de
 *    variables) sans littéral relatif identifiable ;
 *  - USAGES LÉGITIMES préservés par whitelist explicite : ressources
 *    statiques réellement utilisées par les générations du produit (CDN
 *    Tailwind, Google Fonts, images placeholder connues) et appels locaux
 *    relatifs (contrat « appels fetch locaux simulés » de l'Agent Backend) ;
 *  - TRACE D'AUDIT : rapport structuré (findings, blockers, hash du contenu)
 *    exploitable par les logs, les événements SSE et le store d'exécution.
 *
 * Ce module N'EST PAS le Quality Gate visuel et ne le remplace pas : il
 * s'ajoute aux contrôles existants (préflight, gate, validation chain) au
 * même titre que le préflight, sans les modifier.
 */

import { createHash } from 'node:crypto';

export interface ExfiltrationFinding {
  /** Id stable, trié par canal (EXF-FETCH-001, EXF-SCRIPT-002, …). */
  readonly id: string;
  /** Canal de transmission : fetch | xhr | beacon | websocket | eventsource |
   *  dynamic-import | form-action | script-src | iframe-src | img-tracking | css-url. */
  readonly channel: string;
  /** Destination identifiée (host) ou 'non-identifiée'. */
  readonly destination: string;
  readonly severity: 'BLOCKER' | 'WARNING';
  /** Extrait court du contenu à l'origine du finding (≤ 120 car.). */
  readonly detail: string;
}

export interface ExfiltrationGuardReport {
  readonly schemaVersion: '1.0.0';
  readonly path: string;
  readonly verdict: 'PASS' | 'PASS_WITH_WARNINGS' | 'FAIL';
  /** true ⟺ aucun bloqueur. */
  readonly passed: boolean;
  readonly findings: readonly ExfiltrationFinding[];
  /** Messages de refus (un par finding bloquant). */
  readonly blockers: readonly string[];
  readonly warnings: readonly string[];
  readonly contentHash: string;
  readonly byteLength: number;
  readonly checkedAt: string;
}

/**
 * Destinations légitimes par canal. Refus par défaut : TOUT ce qui n'y figure
 * pas est refusé. Liste fermée, dérivée des usages réellement observés dans
 * les générations du produit (preuves É49 : head T3 = Tailwind CDN + fonts) —
 * élargir cette liste exige une décision explicite, pas un contournement.
 */
const SCRIPT_IFRAME_HOSTS = new Set([
  'cdn.tailwindcss.com',
  'tailwindcss.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'www.youtube.com',
  'youtube-nocookie.com',
  'player.vimeo.com'
]);

const CSS_HOSTS = new Set([
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.tailwindcss.com'
]);

/** Images placeholder légitimes SANS query string (avec query = tracking). */
const IMAGE_HOSTS = new Set([
  'picsum.photos',
  'images.unsplash.com',
  'source.unsplash.com',
  'placehold.co',
  'via.placeholder.com',
  'dummyimage.com',
  'placekitten.com',
  'img.icons8.com',
  'cdn-icons-png.flaticon.com',
  'api.iconify.design',
  'cdn.simpleicons.org'
]);

const MAX_FINDINGS = 20;

function hashOf(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 32);
}

/** Extrait le host d'une URL littérale ; 'non-identifiée' si non parseable. */
function hostOf(url: string): string {
  const trimmed = url.trim().replace(/^['"`]/, '').replace(/['"`],?\s*$/, '');
  try {
    const parsed = new URL(trimmed);
    return parsed.hostname || 'non-identifiée';
  } catch {
    // URL fragmentée ou partiellement construite : destination inconnue.
    return 'non-identifiée';
  }
}

/** true si l'URL littérale est résolvable ET son host est dans la whitelist. */
function isAllowedHost(url: string, allow: Set<string>): boolean {
  const trimmed = url.trim().replace(/^['"`]/, '').replace(/['"`],?\s*$/, '');
  try {
    const parsed = new URL(trimmed);
    if (!parsed.hostname) return false;
    return allow.has(parsed.hostname);
  } catch {
    return false; // non parseable = non autorisé (refus par défaut)
  }
}

function hasQueryString(url: string): boolean {
  const idx = url.indexOf('?');
  if (idx === -1) return false;
  // '?' suivi d'au moins un caractère non-fermeture = query réelle.
  return idx + 1 < url.length && !/^['"`]\s*$/.test(url.slice(idx + 1));
}

function finding(
  id: string,
  channel: string,
  destination: string,
  severity: 'BLOCKER' | 'WARNING',
  content: string,
  index: number
): ExfiltrationFinding {
  return {
    id,
    channel,
    destination,
    severity,
    detail: content.slice(Math.max(0, index), index + 120).replace(/\s+/g, ' ').trim()
  };
}

/**
 * Analyse le contenu HTML/JS candidat et retourne le rapport. Déterministe :
 * même contenu → même rapport (hash inclus). Aucune requête réseau, aucun
 * rendu : scan textuel frontière, exécuté en millisecondes.
 */
export function runExfiltrationGuard(content: string, path: string): ExfiltrationGuardReport {
  const findings: ExfiltrationFinding[] = [];
  let counter = 0;

  const push = (
    channel: string,
    destination: string,
    severity: 'BLOCKER' | 'WARNING',
    index: number
  ): void => {
    if (findings.length >= MAX_FINDINGS) return;
    counter += 1;
    findings.push(finding(`EXF-${channel.toUpperCase()}-${String(counter).padStart(3, '0')}`, channel, destination, severity, content, index));
  };

  // ---- 1. Canaux JS de transmission : fetch/XHR/beacon/WebSocket/EventSource/import()
  // Une fenêtre de 240 caractères après l'appel capture l'URL littérale
  // (directe, template literal ou en fin de premier argument). Toute URL
  // absolu non whitelistée (ou non parseable) = bloqueur.
  const jsChannels: ReadonlyArray<{ rx: RegExp; channel: string }> = [
    { rx: /\bfetch\s*\(/gi, channel: 'fetch' },
    { rx: /\.open\s*\((?=[^)]{0,160}?(?:https?:\/\/|wss?:\/\/))/gi, channel: 'xhr' },
    { rx: /\bsendBeacon\s*\(/gi, channel: 'beacon' },
    { rx: /\bWebSocket\s*\(/gi, channel: 'websocket' },
    { rx: /\bEventSource\s*\(/gi, channel: 'eventsource' },
    { rx: /\bimport\s*\(\s*['"`]?https?/gi, channel: 'dynamic-import' }
  ];
  for (const { rx, channel } of jsChannels) {
    rx.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rx.exec(content)) !== null) {
      const windowText = content.slice(m.index, m.index + 240);
      const urlMatch = windowText.match(/(?:https?|wss?):\/\/[^\s'"`),;\\]{4,200}/);
      if (urlMatch) {
        const url = urlMatch[0];
        const dest = hostOf(url);
        const allowed =
          channel === 'websocket'
            ? false // aucune destination WS légitime en génération — refus par défaut
            : isAllowedHost(url, SCRIPT_IFRAME_HOSTS);
        if (!allowed) {
          push(channel, dest, 'BLOCKER', m.index);
        }
      } else {
        // Pas d'URL absolu littérale dans la fenêtre : l'argument est-il
        // identifiable comme un littéral relatif local ('/api/…', './x') ?
        // Oui → usage légitime (contrat Agent Backend). Sinon, la
        // destination est dynamique/non identifiable (concaténation,
        // variable) : refus par défaut — impossible de vérifier le host,
        // c'est le cas S8 contourné par construction d'URL.
        const argHead = windowText.slice(0, 200);
        const isRelativeLiteral = /['"`]\s*\.?\/[^\s'"`]/.test(argHead);
        if (!isRelativeLiteral) {
          push(channel, 'non-identifiée', 'BLOCKER', m.index);
        }
      }
    }
  }

  // ---- 2. <form action="URL absolu"> : soumission de données utilisateur vers un tiers.
  const formRx = /<form\b[^>]*\baction\s*=\s*["']([^"']*)["'][^>]*>/gi;
  let fm: RegExpExecArray | null;
  while ((fm = formRx.exec(content)) !== null) {
    const action = fm[1] ?? '';
    if (/^\s*(https?:)?\/\//i.test(action) && !isAllowedHost(action, SCRIPT_IFRAME_HOSTS)) {
      push('form-action', hostOf(action), 'BLOCKER', fm.index);
    }
  }

  // ---- 3. <script src="URL absolu"> : exécution de code tiers.
  const scriptRx = /<script\b[^>]*\bsrc\s*=\s*["']([^"']*)["'][^>]*>/gi;
  let sm: RegExpExecArray | null;
  while ((sm = scriptRx.exec(content)) !== null) {
    const src = sm[1] ?? '';
    if (/^\s*(https?:)?\/\//i.test(src) && !isAllowedHost(src, SCRIPT_IFRAME_HOSTS)) {
      push('script-src', hostOf(src), 'BLOCKER', sm.index);
    }
  }

  // ---- 4. <iframe src="URL absolu"> : contenu exécutable embarqué.
  const iframeRx = /<iframe\b[^>]*\bsrc\s*=\s*["']([^"']*)["'][^>]*>/gi;
  let im: RegExpExecArray | null;
  while ((im = iframeRx.exec(content)) !== null) {
    const src = im[1] ?? '';
    if (/^\s*(https?:)?\/\//i.test(src) && !isAllowedHost(src, SCRIPT_IFRAME_HOSTS)) {
      push('iframe-src', hostOf(src), 'BLOCKER', im.index);
    }
  }

  // ---- 5. Images : refus par défaut du TRACKING (query string = exfiltration
  // d'URL/données), placeholder sans query hors whitelist = simple avertissement.
  const imgRx = /<(?:img|source)\b[^>]*\bsrc(?:set)?\s*=\s*["']([^"']*)["'][^>]*>/gi;
  let imgm: RegExpExecArray | null;
  while ((imgm = imgRx.exec(content)) !== null) {
    const src = imgm[1] ?? '';
    const first = src.split(/[\s,]+/)[0] ?? '';
    if (!/^\s*(https?:)?\/\//i.test(first)) continue;
    const host = hostOf(first);
    if (IMAGE_HOSTS.has(host)) continue;
    if (hasQueryString(first)) {
      push('img-tracking', host, 'BLOCKER', imgm.index);
    } else {
      push('img-external', host, 'WARNING', imgm.index);
    }
  }

  // ---- 6. CSS url(https://…) : fonts légitimes OK ; query = tracking.
  const cssRx = /url\(\s*['"]?(https?:\/\/[^)'"]+)/gi;
  let cm: RegExpExecArray | null;
  while ((cm = cssRx.exec(content)) !== null) {
    const url = cm[1] ?? '';
    const host = hostOf(url);
    if (CSS_HOSTS.has(host)) continue;
    if (hasQueryString(url)) {
      push('css-url', host, 'BLOCKER', cm.index);
    } else {
      push('css-url', host, 'WARNING', cm.index);
    }
  }

  const blockers = findings
    .filter((f) => f.severity === 'BLOCKER')
    .map((f) => `${f.id} (${f.channel}) → ${f.destination}`);
  const warnings = findings
    .filter((f) => f.severity === 'WARNING')
    .map((f) => `${f.id} (${f.channel}) → ${f.destination}`);

  return {
    schemaVersion: '1.0.0',
    path,
    verdict: blockers.length > 0 ? 'FAIL' : warnings.length > 0 ? 'PASS_WITH_WARNINGS' : 'PASS',
    passed: blockers.length === 0,
    findings,
    blockers,
    warnings,
    contentHash: hashOf(content),
    byteLength: Buffer.byteLength(content, 'utf8'),
    checkedAt: new Date().toISOString()
  };
}

/**
 * Message utilisateur HONNÊTE pour un refus : nomme le canal et la
 * destination, affirme qu'aucun fichier n'a été modifié, donne l'action.
 */
export function describeExfiltrationBlocker(report: ExfiltrationGuardReport): string {
  const dests = [...new Set(report.findings.filter((f) => f.severity === 'BLOCKER').map((f) => f.destination))];
  const channels = [...new Set(report.findings.filter((f) => f.severity === 'BLOCKER').map((f) => f.channel))];
  return (
    `Écriture refusée par le garde-fou sécurité : le site généré tente d'envoyer des données vers ` +
    `${dests.slice(0, 3).join(', ')} (canal ${channels.join(', ')}). ` +
    `Aucun fichier n'a été modifié. Reformule ta demande sans destination externe non autorisée ` +
    `(les ressources autorisées : Tailwind CDN, Google Fonts, images placeholder, appels locaux relatifs).`
  );
}
