/**
 * VibeCode Core - LOT MULTI-MODÈLES — Catalogue + sélecteur de fournisseur IA.
 *
 * Source unique de vérité des 10 fournisseurs exposés au tableau de bord
 * (statut clé masqué, commutateur ON/OFF) et à l'enregistrement serveur.
 *
 * Règle de sécurité : ce module ne stocke JAMAIS de clé. Il lit uniquement la
 * PRÉSENCE des clés d'environnement (nommées ici), jamais leur valeur.
 * L'état « actif » (modèle employé par la génération) est persisté (identifiant
 * de fournisseur seulement) dans un fichier du répertoire de données runtime
 * (VOLACO_DATA_DIR, sinon ./.volaco-data — gitignored) ; dégradation gracieuse
 * en mémoire seule si l'écriture échoue.
 *
 * Comportement héritage garanti : sans état actif, `preferredAiProvider()`
 * retourne undefined — les sites d'appel conservent alors leur choix historique
 * (mistral si MISTRAL_API_KEY, sinon gemini). Aucune régression par défaut.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProviderCapability, ProviderAvailability, ProviderHealthStatus } from './types.js';

export interface ProviderCatalogEntry {
  readonly providerId: string;
  readonly providerName: string;
  /** Variables d'environnement acceptées pour la clé (1re présente gagne). */
  readonly envKeys: readonly string[];
  /** Variable d'environnement optionnelle pour le modèle par défaut. */
  readonly modelEnvKey?: string;
  /** Base URL du endpoint (SANS /chat/completions ; Claude SANS /v1/messages). */
  readonly baseUrl: string;
  readonly defaultModel: string;
  readonly models: readonly string[];
  readonly contextWindow: number;
  readonly capabilities: readonly ProviderCapability[];
  readonly reasoning: boolean;
  readonly vision: boolean;
  /** true pour les formats compatibles OpenAI ; false pour les formats propres. */
  readonly openaiCompatible: boolean;
}

/** Configuration d'un fournisseur compatible OpenAI pour l'adaptateur générique. */
export type OpenAiCompatibleProviderConfig = ProviderCatalogEntry;

function envKeysFor(providerId: string): readonly string[] {
  switch (providerId) {
    case 'openai': return ['OPENAI_API_KEY'];
    case 'deepseek': return ['DEEPSEEK_API_KEY'];
    case 'kimi': return ['MOONSHOT_API_KEY', 'KIMI_API_KEY'];
    case 'glm': return ['ZHIPU_API_KEY', 'GLM_API_KEY'];
    case 'qwen': return ['DASHSCOPE_API_KEY', 'QWEN_API_KEY'];
    case 'groq': return ['GROQ_API_KEY'];
    case 'xai': return ['XAI_API_KEY', 'GROK_API_KEY'];
    default: return [`${providerId.toUpperCase()}_API_KEY`];
  }
}

/** Les 7 fournisseurs compatibles OpenAI (exclut mistral, gemini, claude). */
export const OPENAI_COMPATIBLE_PROVIDERS: readonly OpenAiCompatibleProviderConfig[] = [
  {
    providerId: 'openai',
    providerName: 'OpenAI',
    envKeys: ['OPENAI_API_KEY'],
    modelEnvKey: 'OPENAI_MODEL',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4o', 'o3-mini', 'gpt-4.1-mini'],
    contextWindow: 128000,
    capabilities: ['FAST', 'CODE_GENERATION', 'STRUCTURED_OUTPUT', 'STREAMING', 'TOOL_CALLING', 'VISION'],
    reasoning: false,
    vision: true,
    openaiCompatible: true
  },
  {
    providerId: 'deepseek',
    providerName: 'DeepSeek',
    envKeys: ['DEEPSEEK_API_KEY'],
    modelEnvKey: 'DEEPSEEK_MODEL',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    contextWindow: 64000,
    capabilities: ['FAST', 'CODE_GENERATION', 'STRUCTURED_OUTPUT', 'STREAMING', 'TOOL_CALLING', 'DEEP_REASONING'],
    reasoning: true,
    vision: false,
    openaiCompatible: true
  },
  {
    providerId: 'kimi',
    providerName: 'Kimi (Moonshot)',
    envKeys: ['MOONSHOT_API_KEY', 'KIMI_API_KEY'],
    modelEnvKey: 'KIMI_MODEL',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'kimi-k2-0905-preview',
    models: ['kimi-k2-0905-preview', 'moonshot-v1-128k', 'moonshot-v1-32k'],
    contextWindow: 131072,
    capabilities: ['FAST', 'CODE_GENERATION', 'STRUCTURED_OUTPUT', 'STREAMING', 'TOOL_CALLING'],
    reasoning: false,
    vision: false,
    openaiCompatible: true
  },
  {
    providerId: 'glm',
    providerName: 'GLM (Zhipu)',
    envKeys: ['ZHIPU_API_KEY', 'GLM_API_KEY'],
    modelEnvKey: 'GLM_MODEL',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4.6',
    models: ['glm-4.6', 'glm-4.5-air', 'glm-4-flash'],
    contextWindow: 128000,
    capabilities: ['FAST', 'CODE_GENERATION', 'STRUCTURED_OUTPUT', 'STREAMING', 'TOOL_CALLING', 'VISION'],
    reasoning: false,
    vision: true,
    openaiCompatible: true
  },
  {
    providerId: 'qwen',
    providerName: 'Qwen (DashScope)',
    envKeys: ['DASHSCOPE_API_KEY', 'QWEN_API_KEY'],
    modelEnvKey: 'QWEN_MODEL',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-max',
    models: ['qwen-max', 'qwen-plus', 'qwen-turbo'],
    contextWindow: 131072,
    capabilities: ['FAST', 'CODE_GENERATION', 'STRUCTURED_OUTPUT', 'STREAMING', 'TOOL_CALLING'],
    reasoning: false,
    vision: false,
    openaiCompatible: true
  },
  {
    providerId: 'groq',
    providerName: 'Groq (Llama)',
    envKeys: ['GROQ_API_KEY'],
    modelEnvKey: 'GROQ_MODEL',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    models: ['llama-3.3-70b-versatile', 'deepseek-r1-distill-llama-70b', 'llama-3.1-8b-instant'],
    contextWindow: 131072,
    capabilities: ['FAST', 'CODE_GENERATION', 'STRUCTURED_OUTPUT', 'STREAMING', 'TOOL_CALLING'],
    reasoning: false,
    vision: false,
    openaiCompatible: true
  },
  {
    providerId: 'xai',
    providerName: 'xAI (Grok)',
    envKeys: ['XAI_API_KEY', 'GROK_API_KEY'],
    modelEnvKey: 'XAI_MODEL',
    baseUrl: 'https://api.x.ai/v1',
    defaultModel: 'grok-4',
    models: ['grok-4', 'grok-3', 'grok-3-mini'],
    contextWindow: 131072,
    capabilities: ['FAST', 'CODE_GENERATION', 'STRUCTURED_OUTPUT', 'STREAMING', 'TOOL_CALLING', 'VISION'],
    reasoning: false,
    vision: true,
    openaiCompatible: true
  }
];

/** Claude : format Anthropic /v1/messages (adaptateur dédié, format exclusif). */
export const CLAUDE_PROVIDER_CONFIG: ProviderCatalogEntry = {
  providerId: 'claude',
  providerName: 'Anthropic Claude',
  envKeys: ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY'],
  modelEnvKey: 'ANTHROPIC_MODEL',
  baseUrl: 'https://api.anthropic.com',
  defaultModel: 'claude-sonnet-4-5',
  models: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4-5'],
  contextWindow: 200000,
  capabilities: ['FAST', 'CODE_GENERATION', 'STRUCTURED_OUTPUT', 'STREAMING', 'TOOL_CALLING', 'LARGE_CONTEXT', 'DEEP_REASONING'],
  reasoning: true,
  vision: true,
  openaiCompatible: false
};

/** Catalogue complet des 10 cartes du tableau de bord (ordre d'affichage). */
export const AI_PROVIDER_CATALOG: readonly ProviderCatalogEntry[] = [
  {
    providerId: 'mistral',
    providerName: 'Mistral AI',
    envKeys: ['MISTRAL_API_KEY'],
    modelEnvKey: 'MISTRAL_MODEL',
    baseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'codestral-latest',
    models: ['codestral-latest', 'mistral-large', 'mistral-small'],
    contextWindow: 131072,
    capabilities: ['FAST', 'CODE_GENERATION', 'STRUCTURED_OUTPUT', 'STREAMING', 'TOOL_CALLING'],
    reasoning: false,
    vision: false,
    openaiCompatible: true
  },
  {
    providerId: 'gemini',
    providerName: 'Google Gemini',
    envKeys: ['GEMINI_API_KEY'],
    modelEnvKey: 'GEMINI_MODEL',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.5-flash',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro'],
    contextWindow: 1048576,
    capabilities: ['FAST', 'CODE_GENERATION', 'STRUCTURED_OUTPUT', 'STREAMING', 'VISION', 'LARGE_CONTEXT'],
    reasoning: true,
    vision: true,
    openaiCompatible: false
  },
  ...OPENAI_COMPATIBLE_PROVIDERS,
  CLAUDE_PROVIDER_CONFIG
];

export function getCatalogEntry(providerId: string): ProviderCatalogEntry | undefined {
  return AI_PROVIDER_CATALOG.find((p) => p.providerId === providerId);
}

/** Clé API courante du fournisseur (pour les seuls ADAPTATEURS côté serveur). */
export function providerEnvKey(providerId: string): string | undefined {
  const entry = getCatalogEntry(providerId);
  if (!entry) return undefined;
  for (const k of entry.envKeys) {
    const v = process.env[k];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return undefined;
}

/** Présence de clé (env OU clé enregistrée dans la carte — booléen exposé au tableau de bord). */
export function providerKeyPresent(providerId: string): boolean {
  return providerEnvKey(providerId) !== undefined || providerStoredKey(providerId) !== undefined;
}

// ==================== État actif (commutateur ON/OFF) ====================

let activeProviderId: string | null = null;
let stateLoaded = false;

interface PersistedState {
  readonly active?: string | null;
}

function dataStatePath(): string | undefined {
  const dataRoot = (process.env.VOLACO_DATA_DIR ?? '').trim().length > 0
    ? process.env.VOLACO_DATA_DIR!.trim()
    : join(process.cwd(), '.volaco-data');
  try {
    if (!existsSync(dataRoot)) return undefined; // pas de racine de données → mémoire seule
    return join(dataRoot, 'ai-providers.json');
  } catch {
    return undefined;
  }
}

function loadStateOnce(): void {
  if (stateLoaded) return;
  stateLoaded = true;
  try {
    const p = dataStatePath();
    if (!p) return;
    const raw = readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw) as PersistedState;
    if (typeof parsed?.active === 'string' && getCatalogEntry(parsed.active)) {
      activeProviderId = parsed.active;
    }
  } catch {
    // absence/corruption → héritage, jamais bloquant
  }
}

function persistState(): void {
  try {
    const p = dataStatePath();
    if (!p) return;
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, JSON.stringify({ active: activeProviderId, updatedAt: new Date().toISOString() }, null, 2) + '\n', 'utf8');
  } catch {
    // persist best-effort : l'état en mémoire reste la vérité d'exécution
  }
}

/**
 * Fournisseur actif (sélection manuelle ON dans le tableau de bord), ou
 * null si aucune sélection → héritage (mistral si clé, sinon gemini).
 */
export function getActiveAiProviderId(): string | null {
  loadStateOnce();
  return activeProviderId;
}

/** Préférence de résolution prête pour ProviderRequirements.preferredProviderId. */
export function preferredAiProvider(): string | undefined {
  const active = getActiveAiProviderId();
  return active === null ? undefined : active;
}

/**
 * Commutateur manuel : ON sur un fournisseur → il devient ACTIF (dernier allumé
 * = modèle employé). OFF sur le fournisseur actif → retour à l'héritage (null).
 * OFF sur un autre fournisseur → sans effet sur l'état actif.
 * Refus clair si aucune clé d'environnement n'est configurée pour le fournisseur.
 */
export function setProviderActive(providerId: string, enabled: boolean): { providerId: string | null; keyPresent: boolean } {
  loadStateOnce();
  const entry = getCatalogEntry(providerId);
  if (!entry) {
    throw new Error(`Fournisseur IA inconnu : ${providerId}`);
  }
  const keyPresent = providerKeyPresent(providerId);
  if (enabled) {
    if (!keyPresent) {
      throw new Error(
        `Aucune clé ${entry.providerName} configurée : ajoutez la variable d'environnement (${entry.envKeys.join(' ou ')}) ou enregistrez une clé dans la carte du tableau de bord.`
      );
    }
    activeProviderId = providerId;
  } else {
    if (activeProviderId === providerId) {
      activeProviderId = null;
    }
  }
  persistState();
  return { providerId: activeProviderId, keyPresent };
}

/** Renouvelle la lecture de l'état persisté (réinitialisation de tests). */
export function resetActiveProviderState(nextActive: string | null = null): void {
  activeProviderId = nextActive;
  stateLoaded = true;
}

// ============ Clés enregistrées depuis les cartes du tableau de bord ============
// Stockage runtime global (mono-opérateur local) : {dataDir}/ai-provider-keys.json
// (gitignored). Une clé enregistrée n'est JAMAIS renvoyée en clair — uniquement
// un indice masqué (4 derniers caractères). Priorité de résolution :
//   credentials du tenant (flux internes) > clé de carte > env.

let storedKeys: Map<string, string> = new Map();
let keysLoaded = false;

function dataStateKeysPath(): string | undefined {
  const dataRoot = (process.env.VOLACO_DATA_DIR ?? '').trim().length > 0
    ? process.env.VOLACO_DATA_DIR!.trim()
    : join(process.cwd(), '.volaco-data');
  try {
    if (!existsSync(dataRoot)) return undefined; // pas de racine de données → mémoire seule
    return join(dataRoot, 'ai-provider-keys.json');
  } catch {
    return undefined;
  }
}

function loadKeysOnce(): void {
  if (keysLoaded) return;
  keysLoaded = true;
  try {
    const p = dataStateKeysPath();
    if (!p) return;
    const parsed = JSON.parse(readFileSync(p, 'utf8')) as { keys?: Record<string, string> };
    if (parsed?.keys && typeof parsed.keys === 'object') {
      for (const [id, key] of Object.entries(parsed.keys)) {
        if (typeof key === 'string' && key.trim().length > 0 && getCatalogEntry(id)) {
          storedKeys.set(id, key.trim());
        }
      }
    }
  } catch {
    // absence/corruption → vide (héritage env), jamais bloquant
  }
}

function persistKeys(): void {
  try {
    const p = dataStateKeysPath();
    if (!p) return;
    mkdirSync(join(p, '..'), { recursive: true });
    const obj: Record<string, string> = {};
    for (const [id, key] of storedKeys) obj[id] = key;
    writeFileSync(p, JSON.stringify({ updatedAt: new Date().toISOString(), keys: obj }, null, 2) + '\n', 'utf8');
  } catch {
    // persist best-effort : l'état en mémoire reste la vérité d'exécution
  }
}

/** Indice sûr : jamais la clé entière — 4 derniers caractères si assez longue. */
export function maskedKeyHint(apiKey: string): string {
  return apiKey.length >= 8 ? `••••${apiKey.slice(-4)}` : '••••';
}

/** Clé API enregistrée depuis la carte du tableau de bord (stockage runtime). */
export function providerStoredKey(providerId: string): string | undefined {
  loadKeysOnce();
  return storedKeys.get(providerId);
}

/** Enregistre (ou supprime si vide) la clé de la carte ; gagne sur l'env. */
export function setProviderStoredKey(providerId: string, apiKey: string | undefined): { stored: boolean; hint: string | null } {
  loadKeysOnce();
  if (!getCatalogEntry(providerId)) {
    throw new Error(`Fournisseur IA inconnu : ${providerId}`);
  }
  const trimmed = (apiKey ?? '').trim();
  if (trimmed.length === 0) {
    storedKeys.delete(providerId);
    persistKeys();
    return { stored: false, hint: null };
  }
  if (trimmed.length > 512) {
    throw new Error('Clé API trop longue (512 caractères maximum).');
  }
  storedKeys.set(providerId, trimmed);
  persistKeys();
  return { stored: true, hint: maskedKeyHint(trimmed) };
}

/** Réinitialisation de l'état des clés (réinitialisation de tests). */
export function resetStoredProviderKeys(): void {
  storedKeys = new Map();
  keysLoaded = true;
}

/** Types réexportés pour les clients du catalogue (évite les imports croisés). */
export type CatalogTypes = {
  readonly ProviderAvailability: ProviderAvailability;
  readonly ProviderHealthStatus: ProviderHealthStatus;
};
