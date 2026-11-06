/**
 * VibeCode Core - Clés API par AGENT (page « Clés API » — choix scellé avec
 * l'opérateur : stockage serveur, bascule automatique tracée).
 *
 * Stockage runtime : {dataDir}/ai-agent-keys.json (gitignored), même régime
 * que ai-provider-keys.json du tableau de bord :
 *   { "updatedAt": "...", "agents": { "<agentId>": { "primary": { "providerId",
 *     "apiKeyEnc" }, "fallback": { ... } } } }
 *
 * LOT S4 — chiffrement at-rest : la clé n'est JAMAIS écrite en clair. Elle est
 * chiffrée AES-256-GCM (même keyring que les clés provider) avant écriture ;
 * la lecture déchiffre l'enveloppe. Sans keyring valide, l'écriture échoue
 * explicitement (fail-closed, jamais un downgrade en clair).
 *
 * Règles (sécurité) :
 *   - la clé n'est JAMAIS renvoyée en clair hors de ce module — seulement un
 *     indice masqué (4 derniers caractères) pour l'interface ;
 *   - agentId borné au roster réel (AGENT_KEYS_IDS — 7 agents enregistrés
 *     dans AIOrchestratorService) ;
 *   - providerId borné au catalogue existant ;
 *   - absence/corruption du fichier → mémoire vide (jamais bloquant).
 *
 * Résolution à l'exécution (base-agent) : primary → échec (erreur appel IA)
 * → fallback → chaîne legacy tenant/env (comportement antérieur, intact quand
 * aucune clé d'agent n'est configurée).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { getCatalogEntry, maskedKeyHint } from './provider-catalog.js';

export interface AgentCredentialSlot {
  readonly providerId: string;
  readonly apiKey: string;
}

export interface AgentCredentialSlots {
  readonly primary?: AgentCredentialSlot | undefined;
  readonly fallback?: AgentCredentialSlot | undefined;
}

export interface AgentKeyHint {
  readonly providerId: string;
  readonly hint: string;
}

export type AgentCredentialSlotName = 'primary' | 'fallback';

/** Roster réel des 7 agents (miroir des registrations de AIOrchestratorService). */
export const AGENT_KEYS_IDS: readonly string[] = [
  'agent-ui-specialist',
  'agent-backend-specialist',
  'agent-data-specialist',
  'agent-security-specialist',
  'agent-test-specialist',
  'agent-code-specialist',
  'reference-agent'
];

const SLOT_NAMES: readonly string[] = ['primary', 'fallback'];

let agentKeys: Map<string, AgentCredentialSlots> = new Map();
let agentKeysLoaded = false;

const AGENT_KEY_BYTES = 32;
function agentDataKey(): { keyId: string; key: Buffer } | null {
  const rawKeyId = process.env.VOLACO_MCP_REMOTE_KEY_ID;
  const rawKey = process.env.VOLACO_MCP_REMOTE_KEY;
  if (typeof rawKeyId !== 'string' || rawKeyId.length === 0) return null;
  if (typeof rawKey !== 'string' || rawKey.length === 0) return null;
  const decoded = Buffer.from(rawKey, 'base64');
  if (decoded.length !== AGENT_KEY_BYTES || decoded.toString('base64') !== rawKey) return null;
  return { keyId: rawKeyId, key: decoded };
}

function aadForAgentKey(agentId: string, slotName: string): Buffer {
  return Buffer.from(`agent-keys:v1:${agentId}:${slotName}`, 'utf8');
}

function encryptAgentKey(agentId: string, slotName: string, plaintext: string): Record<string, string> {
  const ring = agentDataKey();
  if (!ring) {
    throw new Error(
      'Chiffrement des clés agent indisponible : VOLACO_MCP_REMOTE_KEY_ID et VOLACO_MCP_REMOTE_KEY (base64 32 octets, clé dédiée distincte de AUTH_SECRET) sont requis.'
    );
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', ring.key, iv);
  cipher.setAAD(aadForAgentKey(agentId, slotName));
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
  const authTag = cipher.getAuthTag().toString('base64');
  return {
    keyId: ring.keyId,
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    authTag
  };
}

function decryptAgentKey(agentId: string, slotName: string, env: Record<string, string>): string | null {
  const ring = agentDataKey();
  if (!ring) return null;
  if (typeof env.keyId !== 'string' || env.keyId !== ring.keyId) return null;
  try {
    const iv = Buffer.from(String(env.iv), 'base64');
    const authTag = Buffer.from(String(env.authTag), 'base64');
    if (iv.length !== 12 || authTag.length !== 16) return null;
    const decipher = createDecipheriv('aes-256-gcm', ring.key, iv);
    decipher.setAAD(aadForAgentKey(agentId, slotName));
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(Buffer.from(String(env.ciphertext), 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

function dataAgentKeysPath(): string | undefined {
  const dataRoot = (process.env.VOLACO_DATA_DIR ?? '').trim().length > 0
    ? process.env.VOLACO_DATA_DIR!.trim()
    : join(process.cwd(), '.volaco-data');
  try {
    if (!existsSync(dataRoot)) return undefined; // pas de racine de données → mémoire seule
    return join(dataRoot, 'ai-agent-keys.json');
  } catch {
    return undefined;
  }
}

function loadAgentKeysOnce(): void {
  if (agentKeysLoaded) return;
  agentKeysLoaded = true;
  try {
    const p = dataAgentKeysPath();
    if (!p) return;
    const parsed = JSON.parse(readFileSync(p, 'utf8')) as { agents?: Record<string, unknown> };
    const agents = parsed?.agents;
    if (!agents || typeof agents !== 'object') return;
    for (const [agentId, rawCfg] of Object.entries(agents)) {
      if (!AGENT_KEYS_IDS.includes(agentId)) continue;
      if (!rawCfg || typeof rawCfg !== 'object') continue;
      const cfg = rawCfg as Record<string, unknown>;
      const cleaned: { primary?: AgentCredentialSlot; fallback?: AgentCredentialSlot } = {};
      for (const slotName of SLOT_NAMES) {
        const slot = cfg[slotName];
        if (!slot || typeof slot !== 'object') continue;
        const s = slot as Record<string, unknown>;
        const providerId = typeof s.providerId === 'string' ? s.providerId.trim() : '';
        const apiKeyRaw = s.apiKeyEnc !== undefined ? s.apiKeyEnc : s.apiKey;
        const apiKey = typeof apiKeyRaw === 'string'
          ? (s.apiKeyEnc !== undefined ? (decryptAgentKey(agentId, slotName, s.apiKeyEnc as Record<string, string>) ?? '').trim() : apiKeyRaw.trim())
          : '';
        if (providerId && apiKey && getCatalogEntry(providerId)) {
          cleaned[slotName as AgentCredentialSlotName] = { providerId, apiKey };
        }
      }
      if (cleaned.primary || cleaned.fallback) {
        agentKeys.set(agentId, cleaned as AgentCredentialSlots);
      }
    }
  } catch {
    // absence/corruption → modules vides, la chaîne legacy reste la vérité
  }
}

function persistAgentKeys(): void {
  try {
    const p = dataAgentKeysPath();
    if (!p) return;
    mkdirSync(join(p, '..'), { recursive: true });
    const obj: Record<string, Record<string, unknown>> = {};
    for (const [id, cfg] of agentKeys) {
      const slots: Record<string, unknown> = {};
      if (cfg.primary) slots.primary = { providerId: cfg.primary.providerId, apiKeyEnc: encryptAgentKey(id, 'primary', cfg.primary.apiKey) };
      if (cfg.fallback) slots.fallback = { providerId: cfg.fallback.providerId, apiKeyEnc: encryptAgentKey(id, 'fallback', cfg.fallback.apiKey) };
      obj[id] = slots;
    }
    writeFileSync(p, JSON.stringify({ updatedAt: new Date().toISOString(), agents: obj }, null, 2) + '\n', 'utf8');
  } catch (err) {
    // L'écriture chiffrée échoue silencieusement (persist best-effort) :
    // l'état en mémoire reste la vérité d'exécution, le fichier reste intact.
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('Chiffrement des clés')) throw err;
  }
}

/** Indice sûr pour l'UI d'un agent : providers + indices, JAMAIS les clés. */
export function agentCredentialHints(agentId: string): { primary?: AgentKeyHint; fallback?: AgentKeyHint } {
  loadAgentKeysOnce();
  const cfg = agentKeys.get(agentId);
  if (!cfg) return {};
  const out: { primary?: AgentKeyHint; fallback?: AgentKeyHint } = {};
  if (cfg.primary) out.primary = { providerId: cfg.primary.providerId, hint: maskedKeyHint(cfg.primary.apiKey) };
  if (cfg.fallback) out.fallback = { providerId: cfg.fallback.providerId, hint: maskedKeyHint(cfg.fallback.apiKey) };
  return out;
}

/** Config complet (usage interne à l'exécution — apiKey sortie du module). */
export function resolveAgentCredentialSlots(agentId: string): AgentCredentialSlots {
  loadAgentKeysOnce();
  return agentKeys.get(agentId) ?? {};
}

/** Enregistre (apiKey non vide) ou supprime (apiKey vide) un slot d'agent. */
export function setAgentCredentialSlot(
  agentId: string,
  slotName: AgentCredentialSlotName,
  providerId: string,
  apiKey: string | undefined
): { stored: boolean; hint: string | null; providerId: string | null } {
  loadAgentKeysOnce();
  if (!AGENT_KEYS_IDS.includes(agentId)) {
    throw new Error(`Agent inconnu : ${agentId}`);
  }
  if (!SLOT_NAMES.includes(slotName)) {
    throw new Error(`Slot invalide : ${slotName} (primary ou fallback attendus)`);
  }
  if (providerId.length === 0 || providerId.length > 32 || !/^[a-z0-9-]+$/.test(providerId) || !getCatalogEntry(providerId)) {
    throw new Error(`Fournisseur IA inconnu : ${providerId}`);
  }
  const trimmed = (apiKey ?? '').trim();
  const cfg: { primary?: AgentCredentialSlot | undefined; fallback?: AgentCredentialSlot | undefined } = { ...agentKeys.get(agentId) };
  if (trimmed.length === 0) {
    delete cfg[slotName];
    if (cfg.primary || cfg.fallback) agentKeys.set(agentId, cfg as AgentCredentialSlots);
    else agentKeys.delete(agentId);
    persistAgentKeys();
    return { stored: false, hint: null, providerId: null };
  }
  if (trimmed.length > 512) {
    throw new Error('Clé API trop longue (512 caractères maximum).');
  }
  if (!agentDataKey()) {
    throw new Error(
      'Chiffrement des clés agent indisponible : VOLACO_MCP_REMOTE_KEY_ID et VOLACO_MCP_REMOTE_KEY (base64 32 octets, clé dédiée distincte de AUTH_SECRET) sont requis.'
    );
  }
  cfg[slotName] = { providerId, apiKey: trimmed };
  agentKeys.set(agentId, cfg as AgentCredentialSlots);
  try { persistAgentKeys(); } catch (err) {
    agentKeys.delete(agentId);
    throw err;
  }
  return { stored: true, hint: maskedKeyHint(trimmed), providerId };
}

/** Réinitialisation mémoire (réinitialisation de tests uniquement). */
export function resetAgentCredentialKeys(): void {
  agentKeys = new Map();
  agentKeysLoaded = true;
}
