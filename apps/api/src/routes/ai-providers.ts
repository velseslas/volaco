/**
 * VibeCode Core - LOT MULTI-MODÈLES — Routes du tableau de bord des fournisseurs IA.
 *
 * Contrat (clés JAMAIS exposées — présence booléenne seulement, règle SEC-003) :
 *  - GET  /api/v1/ai/providers           → catalogue des 10 cartes + état actif;
 *  - POST /api/v1/ai/providers/select    → {providerId, enabled} : commutateur
 *    ON (devenir le fournisseur actif ; refus clair sans clé env) / OFF
 *    (retrait de l'état actif → héritage mistral/gemini).
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { ValidationError } from '../../../../packages/core/src/errors.js';
import { assertPermission } from '../../../../packages/core/src/identity/permissions.js';
import { readBody } from '../middleware/body.js';
import type { RequestContext } from '../middleware/auth.js';
import {
  AI_PROVIDER_CATALOG,
  getCatalogEntry,
  getActiveAiProviderId,
  maskedKeyHint,
  providerEnvKey,
  providerKeyPresent,
  providerStoredKey,
  setProviderActive,
  setProviderStoredKey
} from '../../../../packages/core/src/ai/providers/provider-catalog.js';

export interface ProviderCardView {
  readonly providerId: string;
  readonly providerName: string;
  readonly defaultModel: string;
  readonly models: readonly string[];
  readonly contextWindow: number;
  readonly capabilities: readonly string[];
  readonly envKeys: readonly string[];
  readonly envKeyPresent: boolean;
  readonly keyStored: boolean;
  /** Indice masqué (4 derniers caractères) — JAMAIS la valeur complète. */
  readonly keyHint: string | null;
  readonly keyPresent: boolean;
  readonly active: boolean;
}

export async function handleAiProviderRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  context: RequestContext,
  requestId: string
): Promise<boolean> {
  if (pathname === '/api/v1/ai/providers' && req.method === 'GET') {
    assertPermission(context.role, 'PROJECT_READ', requestId);
    const active = getActiveAiProviderId();
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      active,
      providers: AI_PROVIDER_CATALOG.map((p) => {
        const stored = providerStoredKey(p.providerId);
        return {
          providerId: p.providerId,
          providerName: p.providerName,
          defaultModel: p.defaultModel,
          models: p.models,
          contextWindow: p.contextWindow,
          capabilities: p.capabilities,
          envKeys: p.envKeys,
          envKeyPresent: providerEnvKey(p.providerId) !== undefined,
          keyStored: stored !== undefined,
          keyHint: stored === undefined ? null : maskedKeyHint(stored),
          keyPresent: providerKeyPresent(p.providerId),
          active: active === p.providerId
        };
      })
    }));
    return true;
  }

  if (pathname === '/api/v1/ai/providers/select' && req.method === 'POST') {
    assertPermission(context.role, 'PROJECT_UPDATE', requestId);
    const bodyText = await readBody(req);
    let body: { providerId?: unknown; enabled?: unknown };
    try {
      body = bodyText ? (JSON.parse(bodyText) as { providerId?: unknown; enabled?: unknown }) : {};
    } catch {
      throw new ValidationError('JSON invalide dans le corps de la requête', undefined, requestId);
    }
    const providerId = typeof body.providerId === 'string' ? body.providerId : '';
    const enabled = body.enabled === undefined ? true : body.enabled === true;
    if (providerId.length === 0 || providerId.length > 32 || !/^[a-z0-9-]+$/.test(providerId)) {
      throw new ValidationError('providerId invalide', undefined, requestId);
    }
    if (typeof providerId !== 'string' || getCatalogEntry(providerId) === undefined) {
      throw new ValidationError(`Fournisseur IA inconnu : ${providerId}`, undefined, requestId);
    }
    try {
      const result = setProviderActive(providerId, enabled);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        providerId,
        enabled,
        active: result.providerId,
        keyPresent: result.keyPresent,
        message: enabled
          ? (result.providerId === providerId
              ? `${getCatalogEntry(providerId)!.providerName} est maintenant le modèle actif de la génération.`
              : 'Commutateur ON enregistré ; l\'état actif reste inchangé.')
          : 'Commutateur OFF enregistré ; retour au modèle hérité (Mistral/Gemini).'
      }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ message, requestId }));
    }
    return true;
  }

  // LOT MULTI-MODÈLES — saisie de clé API depuis la carte du tableau de bord :
  // stockée côté serveur (gitignored, runtime), JAMAIS renvoyée en clair.
  // Un corps {apiKey:""} vide supprime la clé enregistrée.
  const keyMatch = /^\/api\/v1\/ai\/providers\/([a-z0-9-]{1,32})\/key$/.exec(pathname);
  if (keyMatch && req.method === 'POST') {
    assertPermission(context.role, 'PROJECT_UPDATE', requestId);
    const bodyText = await readBody(req);
    let body: { apiKey?: unknown };
    try {
      body = bodyText ? (JSON.parse(bodyText) as { apiKey?: unknown }) : {};
    } catch {
      throw new ValidationError('JSON invalide dans le corps de la requête', undefined, requestId);
    }
    const providerId = String(keyMatch[1] ?? '');
    if (getCatalogEntry(providerId) === undefined) {
      throw new ValidationError(`Fournisseur IA inconnu : ${providerId}`, undefined, requestId);
    }
    if (body.apiKey !== undefined && typeof body.apiKey !== 'string') {
      throw new ValidationError('apiKey doit être une chaîne (ou absente pour suppression)', undefined, requestId);
    }
    try {
      const result = setProviderStoredKey(providerId, typeof body.apiKey === 'string' ? body.apiKey : '');
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        providerId,
        keyStored: result.stored,
        keyHint: result.hint,
        message: result.stored
          ? `Clé ${getCatalogEntry(providerId)!.providerName} enregistrée côté serveur (${result.hint}). Vous pouvez activer la carte.`
          : `Clé ${getCatalogEntry(providerId)!.providerName} supprimée du stockage serveur.`
      }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ message, requestId }));
    }
    return true;
  }

  return false;
}
