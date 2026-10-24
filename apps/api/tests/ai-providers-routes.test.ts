/**
 * LOT MULTI-MODÈLES — routes du tableau de bord des fournisseurs IA.
 *
 *   GET  /api/v1/ai/providers        → catalogue des 10 cartes + état actif
 *   POST /api/v1/ai/providers/select → commutateur ON/OFF (bascule manuelle)
 *
 * Sécurité prouvée :
 *  - aucune clé (ni valeur ni empreinte) n'est retournée — présence booléenne ;
 *  - PROJECT_UPDATE requis pour basculer (VIEWER refusé) ;
 *  - fournisseur inconnu / providerId malformé → 400 ;
 *  - sans état actif : GET active === null (héritage Mistral/Gemini).
 *
 * Zéro réseau : aucune route de ce lot n'appelle un fournisseur.
 */

process.env.VOLACO_EXECUTION_TIMELINE = 'off';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';
import {
  AI_PROVIDER_CATALOG,
  preferredAiProvider,
  resetActiveProviderState,
  resetStoredProviderKeys
} from '../../../packages/core/src/ai/providers/provider-catalog.js';

let server: Server;
let baseUrl = '';
let dataDir = '';

const KEYS_TO_CLEAR = AI_PROVIDER_CATALOG.flatMap((p) => p.envKeys);
const savedEnv = new Map<string, string | undefined>();

interface ProviderView {
  providerId: string;
  providerName: string;
  defaultModel: string;
  models: readonly string[];
  envKeys: readonly string[];
  envKeyPresent: boolean;
  keyStored: boolean;
  keyHint: string | null;
  keyPresent: boolean;
  active: boolean;
}

interface ListBody {
  active: string | null;
  providers: ProviderView[];
}

const getProviders = async (role = 'ADMIN'): Promise<{ status: number; body: ListBody }> => {
  const res = await fetch(`${baseUrl}/api/v1/ai/providers`, {
    headers: { 'x-tenant-id': 'tenant_mm_01', 'x-user-role': role }
  });
  const body = (await res.json()) as unknown as ListBody;
  return { status: res.status, body };
};

/** Entêtes HTTP du lot (ADMIN = PROJECT_UPDATE requis pour clé/bascule). */
const providerHttpHeaders = (): Record<string, string> => ({
  'Content-Type': 'application/json',
  'x-tenant-id': 'tenant_mm_01',
  'x-user-role': 'ADMIN'
});

const postSelect = async (
  payload: Record<string, unknown>,
  role = 'ADMIN'
): Promise<{ status: number; body: Record<string, unknown> }> => {
  const res = await fetch(`${baseUrl}/api/v1/ai/providers/select`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-tenant-id': 'tenant_mm_01',
      'x-user-role': role
    },
    body: JSON.stringify(payload)
  });
  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body };
};

before(() => {
  // Isolation stricte : clés purgées, état actif nul, données runtime hors dépôt.
  for (const key of KEYS_TO_CLEAR) {
    savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }
  savedEnv.set('VOLACO_DATA_DIR', process.env.VOLACO_DATA_DIR);
  dataDir = mkdtempSync(join(tmpdir(), 'opencode', 'mm-test-data-'));
  process.env.VOLACO_DATA_DIR = dataDir;
  resetActiveProviderState(null);
  resetStoredProviderKeys();

  const instance = createApiServer({ port: 0 });
  server = instance.server;
  return new Promise<void>((resolve) => {
    server.listen(0, () => {
      const address = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

after(() => {
  resetActiveProviderState(null);
  resetStoredProviderKeys();
  try {
    server.close();
  } catch {
    // déjà fermé
  }
  process.env.VOLACO_DATA_DIR = savedEnv.get('VOLACO_DATA_DIR');
  for (const [key, value] of savedEnv) {
    if (key === 'VOLACO_DATA_DIR') continue;
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // nettoyage best-effort
  }
});

describe('GET /api/v1/ai/providers', () => {
  it('retourne exactement les 10 cartes avec statut clé masqué (booléen)', async () => {
    const { status, body } = await getProviders();
    assert.equal(status, 200);
    assert.equal(body.providers.length, 10);
    const mistral = body.providers.find((p) => p.providerId === 'mistral');
    assert.ok(mistral);
    assert.deepEqual(mistral!.envKeys, ['MISTRAL_API_KEY']);
    // Aucune valeur de clé ne doit JAMAIS fuiter dans la réponse
    const raw = JSON.stringify(body);
    assert.equal(raw.includes('sk-'), false, 'aucun secret dans la liste');
    assert.equal(raw.includes('sk_'), false, 'aucun secret dans la liste');
  });

  it('sans sélection : active === null (héritage strict)', async () => {
    const { body } = await getProviders();
    assert.equal(body.active, null);
    assert.equal(body.providers.every((p) => p.active === false), true);
    assert.equal(body.providers.every((p) => p.keyPresent === false), true, 'clés purgées → toutes absentes');
  });
});

describe('POST /api/v1/ai/providers/select', () => {
  it('bascule refusée pour un rôle sans PROJECT_UPDATE (VIEWER → 403)', async () => {
    process.env.OPENAI_API_KEY = 'sk-route-test-1';
    const { status } = await postSelect({ providerId: 'openai', enabled: true }, 'VIEWER');
    assert.equal(status, 403);
    assert.equal(preferredAiProvider(), undefined, 'aucun effet de bord sur un refus');
  });

  it('providerId inconnu ou malformé → 400 sans changement d’état', async () => {
    const unknown = await postSelect({ providerId: 'cubicle', enabled: true });
    assert.equal(unknown.status, 400);
    const malformed = await postSelect({ providerId: 'openai!', enabled: true });
    assert.equal(malformed.status, 400);
    const empty = await postSelect({ enabled: true });
    assert.equal(empty.status, 400);
    assert.equal(preferredAiProvider(), undefined);
  });

  it('ON avec clé → le fournisseur devient actif (message explicite)', async () => {
    process.env.OPENAI_API_KEY = 'sk-route-test-2';
    const { status, body } = await postSelect({ providerId: 'openai', enabled: true });
    assert.equal(status, 200);
    assert.equal(body.active, 'openai');
    assert.match(String(body.message ?? ''), /actif/);
    const { body: list } = await getProviders();
    assert.equal(list.active, 'openai');
    const openaiCard = list.providers.find((p) => p.providerId === 'openai');
    assert.equal(openaiCard!.active, true);
    assert.equal(openaiCard!.keyPresent, true);
  });

  it('la bascule ON sur un second fournisseur DÉPLACE l’état actif (dernier allumé gagne)', async () => {
    process.env.GROQ_API_KEY = 'gsk-route-test-3';
    await postSelect({ providerId: 'groq', enabled: true });
    const { body } = await getProviders();
    assert.equal(body.active, 'groq');
    assert.equal(body.providers.find((p) => p.providerId === 'openai')!.active, false);
    assert.equal(body.providers.find((p) => p.providerId === 'groq')!.active, true);
  });

  it('ON sans clé d’environnement → 400 avec la variable attendue citée', async () => {
    delete process.env.QWEN_API_KEY;
    delete process.env.DASHSCOPE_API_KEY;
    const { status, body } = await postSelect({ providerId: 'qwen', enabled: true });
    assert.equal(status, 400);
    assert.match(String(body.message ?? ''), /DASHSCOPE_API_KEY|QWEN_API_KEY/);
    assert.equal((await getProviders()).body.active, 'groq', 'l’actif est intact');
  });

  it('OFF sur l’actif → retour à l’héritage (null) ; OFF sur non-actif sans effet', async () => {
    const offGroq = await postSelect({ providerId: 'groq', enabled: false });
    assert.equal(offGroq.status, 200);
    assert.equal(offGroq.body.active, null);
    const offOthers = await postSelect({ providerId: 'groq', enabled: false });
    assert.equal(offOthers.status, 200);
    assert.equal(offOthers.body.active, null);
    assert.equal((await getProviders()).body.active, null);
  });
});

describe('POST /api/v1/ai/providers/:id/key (saisie dans les cartes)', () => {
  before(() => {
    resetActiveProviderState(null);
    resetStoredProviderKeys();
    // Les tests précédents de ce fichier posent des clés env (OPENAI/GROQ) :
    // purge locale pour prouver que la CLÉ DE CARTE suffit seule
    // (l'after() global du fichier restaure l'environnement d'origine).
    delete process.env.OPENAI_API_KEY;
    delete process.env.GROQ_API_KEY;
  });

  after(() => {
    resetActiveProviderState(null);
    resetStoredProviderKeys();
  });

  const CARD_KEY = 'sk-card-route-test-4321';

  it('refus 403 sans permission de mise à jour (VIEWER)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/ai/providers/openai/key`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': 'tenant_mm_01',
        'x-user-role': 'VIEWER'
      },
      body: JSON.stringify({ apiKey: CARD_KEY })
    });
    assert.equal(res.status, 403);
  });

  it('clé fournisseur inconnu → 400', async () => {
    const res = await fetch(`${baseUrl}/api/v1/ai/providers/cubicle/key`, {
      method: 'POST',
      headers: providerHttpHeaders(),
      body: JSON.stringify({ apiKey: CARD_KEY })
    });
    assert.equal(res.status, 400);
  });

  it('enregistre la clé ; GET expose seulement l’indice masqué, JAMAIS la valeur', async () => {
    const res = await fetch(`${baseUrl}/api/v1/ai/providers/openai/key`, {
      method: 'POST',
      headers: providerHttpHeaders(),
      body: JSON.stringify({ apiKey: CARD_KEY })
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { keyStored: boolean; keyHint: string | null };
    assert.equal(body.keyStored, true);
    assert.equal(body.keyHint, '••••4321');

    const { status, body: list } = await getProviders();
    assert.equal(status, 200);
    const openaiCard = list.providers.find((p) => p.providerId === 'openai');
    assert.equal(openaiCard!.envKeyPresent, false, 'aucune env openai dans ce lot');
    assert.equal(openaiCard!.keyStored, true);
    assert.equal(openaiCard!.keyPresent, true);
    assert.equal(openaiCard!.keyHint, '••••4321');
    const raw = JSON.stringify(list);
    assert.equal(raw.includes(CARD_KEY), false, 'la valeur complète de la clé ne fuit JAMAIS dans la liste');
  });

  it('la clé de carte suffit pour la bascule ON (sans env) ; puis OFF → héritage', async () => {
    const on = await postSelect({ providerId: 'openai', enabled: true });
    assert.equal(on.status, 200);
    assert.equal(on.body.active, 'openai');
    assert.equal((await getProviders()).body.active, 'openai');
    const off = await postSelect({ providerId: 'openai', enabled: false });
    assert.equal(off.status, 200);
    assert.equal(off.body.active, null);
  });

  it('champ vide → suppression ; bascule suivante refusée faute de clé', async () => {
    const del = await fetch(`${baseUrl}/api/v1/ai/providers/openai/key`, {
      method: 'POST',
      headers: providerHttpHeaders(),
      body: JSON.stringify({ apiKey: '' })
    });
    assert.equal(del.status, 200);
    const body = (await del.json()) as { keyStored: boolean };
    assert.equal(body.keyStored, false);
    const attempt = await postSelect({ providerId: 'openai', enabled: true });
    assert.equal(attempt.status, 400);
    assert.match(String(attempt.body.message ?? ''), /OPENAI_API_KEY|carte/);
  });

  it('type invalide (apiKey non-chaîne) → 400', async () => {
    const res = await fetch(`${baseUrl}/api/v1/ai/providers/openai/key`, {
      method: 'POST',
      headers: providerHttpHeaders(),
      body: JSON.stringify({ apiKey: 12345 })
    });
    assert.equal(res.status, 400);
  });
});
