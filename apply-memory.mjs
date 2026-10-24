#!/usr/bin/env node
/**
 * apply-memory.mjs — mémoire du chat (étape 2).
 *
 * Ce que ça change (serveur uniquement) :
 *  - les 6 derniers échanges de la conversation sont envoyés au modèle (construction
 *    et réponses aux questions), bornés en taille ;
 *  - le classeur d'intention les reçoit aussi : « et maintenant en bleu ? » est compris
 *    comme une modification de la page existante, plus comme une simple question.
 *
 * Usage (à la racine du projet, là où se trouve le dossier apps/) :
 *   node apply-memory.mjs            applique (sauvegardes automatiques)
 *   node apply-memory.mjs --check    vérifie seulement, n'écrit rien
 *   node apply-memory.mjs --revert   restaure les sauvegardes
 * Puis : npm run build  et relancer le serveur.
 */
import fs from 'node:fs';
import path from 'node:path';

const CONV = path.resolve('apps/api/src/routes/conversation.ts');
const INTENT = path.resolve('packages/core/src/ai-native/conversation-intelligence/engine/intent-engine.ts');
const TEST = path.resolve('apps/api/tests/memory-conversation.test.ts');
const BAK_DIR = path.resolve('.memory-backup');
const bakOf = (p) => path.join(BAK_DIR, path.basename(p) + '.bak');
const mode = process.argv[2] || '';

function fail(msg) { console.error('✗ ' + msg); process.exit(1); }
function read(p) { const raw = fs.readFileSync(p, 'utf8'); return { crlf: raw.includes('\r\n'), src: raw.replace(/\r\n/g, '\n') }; }
function write(p, o) { fs.writeFileSync(p, o.crlf ? o.src.replace(/\n/g, '\r\n') : o.src, 'utf8'); }
function count(s, a) { return s.split(a).length - 1; }

for (const p of [CONV, INTENT]) {
  if (!fs.existsSync(p)) fail('Fichier introuvable : ' + p + ' (lance la commande à la racine du projet).');
}

if (mode === '--revert') {
  let n = 0;
  for (const p of [CONV, INTENT]) {
    if (fs.existsSync(bakOf(p))) { fs.copyFileSync(bakOf(p), p); n++; console.log('✓ restauré : ' + path.relative(process.cwd(), p)); }
  }
  if (fs.existsSync(TEST) && fs.readFileSync(TEST, 'utf8').includes('MEMOIRE-CONVERSATION')) { fs.unlinkSync(TEST); console.log('✓ test retiré : ' + path.relative(process.cwd(), TEST)); }
  if (!n) fail('Aucune sauvegarde à restaurer.');
  process.exit(0);
}

const conv = read(CONV);
const intent = read(INTENT);

if (conv.src.includes('MEMOIRE-CONVERSATION') || intent.src.includes('MEMOIRE-CONVERSATION')) fail('La mémoire du chat est déjà appliquée. Rien n\'a été changé.');
if (fs.existsSync(TEST)) fail('Le fichier ' + path.relative(process.cwd(), TEST) + ' existe déjà : rien n\'a été modifié.');

const HELPER = String.raw`/**
 * MEMOIRE-CONVERSATION — historique récent injecté dans les prompts
 * (classement d'intention, réponse aux questions, construction), pour que les
 * messages courts qui prolongent l'échange (« et en bleu ? », « plus grand »)
 * soient compris. Borné en nombre de tours et en taille.
 */
export interface MemoryTurn {
  readonly userMessage: { readonly content: string };
  readonly agentResponse: { readonly content: string };
}

export function buildConversationMemory(turns: readonly MemoryTurn[], maxTurns = 6, maxChars = 3500): string {
  const clip = (s: string, n: number): string => {
    const c = String(s || '').replace(/\s+/g, ' ').trim();
    return c.length > n ? c.slice(0, n - 1) + '…' : c;
  };
  const usable = turns.filter((t) => clip(t.userMessage.content, 1).length > 0).slice(-maxTurns);
  if (usable.length === 0) return '';
  const head =
    "HISTORIQUE RÉCENT DE LA CONVERSATION (du plus ancien au plus récent) — sert à comprendre les messages courts qui prolongent l'échange (« et en bleu ? », « plus grand », « comme avant ») :\n";
  const lines = usable.map(
    (t) => 'Utilisateur : ' + clip(t.userMessage.content, 400) + '\nAssistant : ' + clip(t.agentResponse.content, 500)
  );
  while (lines.length > 1 && (head + lines.join('\n')).length > maxChars) lines.shift();
  return head + lines.join('\n');
}

`;
const TEST_SRC = String.raw`/**
 * MEMOIRE-CONVERSATION — historique récent dans les prompts.
 * 1. buildConversationMemory : ordre, bornes, troncature, vide.
 * 2. Flux /stream de bout en bout (Mistral simulé) : le 2e message d'une
 *    session reçoit l'historique ; le classeur d'intention le reçoit aussi
 *    (« et maintenant en bleu ? » devient une modification, pas une question) ;
 *    une session neuve n'en reçoit pas ; le chemin « question » l'inclut.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';
import { buildConversationMemory } from '../src/routes/conversation.js';

process.env.MISTRAL_API_KEY = 'test-key-memory';

const turn = (u: string, a: string) => ({ userMessage: { content: u }, agentResponse: { content: a } });

describe('MEMOIRE-CONVERSATION — buildConversationMemory', () => {
  it('retourne une chaîne vide sans historique', () => {
    assert.equal(buildConversationMemory([]), '');
  });
  it('liste les échanges du plus ancien au plus récent', () => {
    const m = buildConversationMemory([turn('Crée une page', 'Synthèse : header'), turn('Ajoute un footer', 'Synthèse : footer')]);
    assert.ok(m.indexOf('Crée une page') < m.indexOf('Ajoute un footer'));
    assert.match(m, /HISTORIQUE RÉCENT/);
  });
  it('ne garde que les derniers tours', () => {
    const turns = Array.from({ length: 10 }, (_v, i) => turn('message numéro ' + i, 'réponse ' + i));
    const m = buildConversationMemory(turns, 3);
    assert.ok(!m.includes('message numéro 6'));
    assert.ok(m.includes('message numéro 7') && m.includes('message numéro 9'));
  });
  it('tronque les messages longs et respecte la taille maximale', () => {
    const long = 'x'.repeat(5000);
    const m = buildConversationMemory([turn(long, long), turn(long, long), turn(long, long), turn(long, long)], 6, 1500);
    assert.ok(m.length <= 1500 + 1000, 'borne respectée (hors dernier tour conservé)');
    assert.ok(!m.includes('x'.repeat(600)), 'les messages sont tronqués');
  });
  it('ignore les tours sans message utilisateur', () => {
    assert.equal(buildConversationMemory([turn('   ', 'rien')]), '');
  });
});

describe('MEMOIRE-CONVERSATION — flux /stream de bout en bout', () => {
  let server: Server;
  let baseUrl: string;
  const realFetch = globalThis.fetch;
  const H = { 'Content-Type': 'application/json', 'x-tenant-id': 'memory-t1', 'x-user-role': 'OWNER' };
  const calls: Array<{ stream: boolean; system: string; user: string }> = [];
  const frame = (s: string): string => 'data: ' + JSON.stringify({ choices: [{ delta: { content: s } }] }) + '\n\n';
  // Section répartie sur plusieurs morceaux, comme un vrai flux (ouverture, contenu, fermeture).
  const SSE = frame('<SECTION name="hero" mode="create">') + frame('<h1>Salut</h1>') + frame('</SECTION>') + 'data: [DONE]\n\n';
  const SSE_ANSWER = 'data: {"choices":[{"delta":{"content":"Voici la réponse."}}]}\n\n' + 'data: [DONE]\n\n';

  before(async () => {
    globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
      let body: { stream?: boolean; messages?: Array<{ role: string; content: string }> } = {};
      try { body = JSON.parse(String(init?.body ?? '{}')); } catch { /* corps vide */ }
      const msgs = body.messages ?? [];
      const system = msgs.find((m) => m.role === 'system')?.content ?? '';
      const user = [...msgs].reverse().find((m) => m.role === 'user')?.content ?? '';
      calls.push({ stream: body.stream === true, system, user });
      if (body.stream === true) {
        const isQuestion = system.includes("assistant conversationnel");
        return new Response(isQuestion ? SSE_ANSWER : SSE, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }
      let content = 'ok';
      if (system.includes('classificateur')) {
        const asked = (user.split('Message à classer : ')[1] ?? user).trim();
        const hasMemory = user.includes('HISTORIQUE RÉCENT');
        let category = 'CREATE';
        if (asked.startsWith('Explique')) category = 'EXPLAIN';
        else if (asked.includes('bleu')) category = hasMemory ? 'MODIFY' : 'QUESTION';
        content = JSON.stringify({ category, urgency: 'NORMAL', confidence: 0.9 });
      }
      return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }], usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    const instance = createApiServer({ port: 0 });
    server = instance.server;
    await new Promise<void>((resolve) => { server.listen(0, () => { baseUrl = 'http://127.0.0.1:' + (server.address() as AddressInfo).port; resolve(); }); });
  });
  after(async () => {
    globalThis.fetch = realFetch;
    await new Promise<void>((resolve) => { server.close(() => resolve()); });
  });

  async function newSession(): Promise<{ projectId: string; sessionId: string }> {
    const p = await realFetch(baseUrl + '/api/v1/projects', { method: 'POST', headers: H, body: JSON.stringify({ name: 'memoire' }) });
    const projectId = ((await p.json()) as { project: { id: string } }).project.id;
    const s = await realFetch(baseUrl + '/api/v1/projects/' + projectId + '/conversation/sessions', { method: 'POST', headers: H, body: '{}' });
    const sessionId = ((await s.json()) as { session: { sessionId: string } }).session.sessionId;
    return { projectId, sessionId };
  }
  async function send(ids: { projectId: string; sessionId: string }, message: string): Promise<string[]> {
    const res = await realFetch(baseUrl + '/api/v1/projects/' + ids.projectId + '/conversation/sessions/' + ids.sessionId + '/stream', { method: 'POST', headers: { ...H, Accept: 'text/event-stream' }, body: JSON.stringify({ message }) });
    const types: string[] = [];
    for (const raw of (await res.text()).split('\n')) {
      const line = raw.trim();
      if (!line.startsWith('data:')) continue;
      try { types.push((JSON.parse(line.slice(5).trim()) as { type: string }).type); } catch { /* ignore */ }
    }
    return types;
  }

  it('2e message : le prompt de construction contient le 1er échange, et « et maintenant en bleu ? » est une modification', async () => {
    const ids = await newSession();
    const first = await send(ids, 'Crée une page de bienvenue pour ma boulangerie');
    assert.ok(first.includes('section_start'), 'le 1er message construit la page');
    calls.length = 0;
    const second = await send(ids, 'et maintenant en bleu ?');
    assert.ok(second.includes('section_start'), 'le message de suivi construit (modification), il ne reste pas une simple réponse');
    const classif = calls.find((c) => !c.stream && c.system.includes('classificateur'));
    assert.ok(classif, 'le classeur a été appelé');
    assert.match(classif!.user, /Crée une page de bienvenue pour ma boulangerie/, 'le classeur voit le 1er message');
    assert.match(classif!.user, /Message à classer : et maintenant en bleu \?/);
    const build = calls.find((c) => c.stream);
    assert.ok(build, 'la génération a été appelée');
    assert.match(build!.user, /Utilisateur : Crée une page de bienvenue pour ma boulangerie/, 'le prompt de construction contient l\'historique');
    assert.match(build!.user, /sections touchées : hero \(create\)/, 'l\'historique dit quelles sections ont été touchées');
  });

  it('session neuve : aucun historique injecté, le même message reste une simple question', async () => {
    const ids = await newSession();
    calls.length = 0;
    const types = await send(ids, 'et maintenant en bleu ?');
    const classif = calls.find((c) => !c.stream && c.system.includes('classificateur'));
    assert.ok(classif);
    assert.ok(!classif!.user.includes('HISTORIQUE RÉCENT'), 'pas d\'historique sur une session neuve');
    assert.ok(!types.includes('section_start'), 'sans contexte, rien n\'est construit (comportement inchangé)');
  });

  it('chemin « question » : l\'historique est inclus dans le prompt', async () => {
    const ids = await newSession();
    await send(ids, 'Crée une page de bienvenue pour ma boulangerie');
    calls.length = 0;
    const types = await send(ids, 'Explique-moi ce que tu viens de faire');
    assert.ok(!types.includes('section_start'), 'une explication ne construit rien');
    const q = calls.find((c) => c.stream);
    assert.ok(q, 'la réponse est générée');
    assert.match(q!.user, /HISTORIQUE RÉCENT/);
    assert.match(q!.user, /Crée une page de bienvenue pour ma boulangerie/);
  });
});
`;

// --- conversation.ts ------------------------------------------------------
const M1 = 'export async function handleConversationRoutes(';
const M2 = "const realIntent = await classifyIntent(body.message || '', undefined, context.tenantId, projectId);";
const M2_NEW =
  "// MEMOIRE-CONVERSATION — historique récent (session courante), injecté dans les prompts.\n" +
  "    const conversationMemory = buildConversationMemory(\n" +
  "      conversationIntelligenceService.getSession(context.tenantId, projectId, sessionId, context.role, requestId)?.turns ?? []\n" +
  "    );\n" +
  "    const realIntent = await classifyIntent(body.message || '', undefined, context.tenantId, projectId, conversationMemory);";
const M3 = "prompt: `Question de l'utilisateur : ";
const M3_NEW = "prompt: (conversationMemory ? conversationMemory + '\\n\\n' : '') + `Question de l'utilisateur : ";
const M5 = "assistantMessage: 'Synthèse : ' + synthesisText,";
const M5_NEW = "assistantMessage: 'Synthèse : ' + synthesisText + (serverSections.length ? ' — sections touchées : ' + serverSections.map((s) => s.name + ' (' + s.mode + ')').join(', ') : ''),";
const M4 = '          prompt: userPrompt,\n          systemPrompt,\n          temperature: 0.4,\n          maxTokens: 8192,';
const M4_NEW = "          prompt: conversationMemory ? conversationMemory + '\\n\\n' + userPrompt : userPrompt,\n          systemPrompt,\n          temperature: 0.4,\n          maxTokens: 8192,";

// --- intent-engine.ts -----------------------------------------------------
const I1 = 'async function classifyIntentViaAI(\n  text: string,\n  tenantId: string,\n  projectId: string\n): Promise<AiClassification | null> {';
const I1_NEW = 'async function classifyIntentViaAI(\n  text: string,\n  tenantId: string,\n  projectId: string,\n  memory = \'\'\n): Promise<AiClassification | null> {';
const I2 = '      { tenantId, projectId, prompt: text, systemPrompt, temperature: 0, maxTokens: 200 },';
const I2_NEW =
  "      {\n" +
  "        tenantId,\n" +
  "        projectId,\n" +
  "        // MEMOIRE-CONVERSATION — le classeur voit les derniers échanges.\n" +
  "        prompt: memory ? memory + '\\n\\nMessage à classer : ' + text : text,\n" +
  "        systemPrompt: memory\n" +
  "          ? systemPrompt + \"\\nUn historique de conversation peut être fourni avant le message à classer. Un message court qui prolonge ce qui précède (ex. « et en bleu ? », « plus grand », « refais-le ») est une demande de modification (MODIFY) de la page existante, pas une QUESTION.\"\n" +
  "          : systemPrompt,\n" +
  "        temperature: 0,\n" +
  "        maxTokens: 200\n" +
  "      },";
const I3 = "  tenantId = 'system',\n  projectId = 'system'\n): Promise<IntentResult> {";
const I3_NEW = "  tenantId = 'system',\n  projectId = 'system',\n  memory = ''\n): Promise<IntentResult> {";
const I4 = 'const aiResult = await classifyIntentViaAI(text, tenantId, projectId);';
const I4_NEW = 'const aiResult = await classifyIntentViaAI(text, tenantId, projectId, memory);';

const checks = [['conversation.ts M1', conv.src, M1], ['conversation.ts M2', conv.src, M2], ['conversation.ts M3', conv.src, M3], ['conversation.ts M4', conv.src, M4], ['conversation.ts M5', conv.src, M5],
                ['intent-engine.ts I1', intent.src, I1], ['intent-engine.ts I2', intent.src, I2], ['intent-engine.ts I3', intent.src, I3], ['intent-engine.ts I4', intent.src, I4]];
for (const [name, text, a] of checks) {
  const n = count(text, a);
  if (n !== 1) fail('Repère « ' + name + ' » : ' + n + ' occurrence(s) au lieu d\'une seule. Tes fichiers ne correspondent pas à ceux attendus : RIEN n\'a été modifié.');
}

let c = conv.src;
c = c.replace(M1, () => HELPER + M1);
c = c.replace(M2, () => M2_NEW);
c = c.replace(M3, () => M3_NEW);
c = c.replace(M4, () => M4_NEW);
c = c.replace(M5, () => M5_NEW);
conv.src = c;

let i = intent.src;
i = i.replace(I1, () => I1_NEW);
i = i.replace(I2, () => I2_NEW);
i = i.replace(I3, () => I3_NEW);
i = i.replace(I4, () => I4_NEW);
intent.src = i;

if (mode === '--check') { console.log('✓ Les 9 repères sont présents : la mémoire du chat peut être appliquée.'); process.exit(0); }

fs.mkdirSync(BAK_DIR, { recursive: true });
fs.copyFileSync(CONV, bakOf(CONV));
fs.copyFileSync(INTENT, bakOf(INTENT));
write(CONV, conv);
write(INTENT, intent);
fs.writeFileSync(TEST, TEST_SRC, 'utf8');
console.log('✓ Serveur modifié : apps/api/src/routes/conversation.ts');
console.log('✓ Serveur modifié : packages/core/src/ai-native/conversation-intelligence/engine/intent-engine.ts');
console.log('✓ Test ajouté     : apps/api/tests/memory-conversation.test.ts');
console.log('  Sauvegardes      : dossier .memory-backup/ (à supprimer quand tout est validé)');
console.log('  Retour arrière   : node apply-memory.mjs --revert');
console.log('  IMPORTANT : lance maintenant  npm run build  puis redémarre le serveur.');
