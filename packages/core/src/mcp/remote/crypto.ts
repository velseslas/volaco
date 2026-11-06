/**
 * C3.1 — Chiffrement AES-256-GCM des secrets de connecteurs MCP distants.
 *
 * Garanties :
 * - clé dédiée DISTINCTE de AUTH_SECRET (rejet en cas de réutilisation,
 *   comparaison sur la valeur brute et sur les 32 octets décodés) ;
 * - unique format de clé accepté : base64 canonique de 32 octets (aucune
 *   dérivation, aucune clé faible par défaut — l'environnement DOIT fournir
 *   la clé, sinon erreur explicite, jamais une clé dérivée par défaut) ;
 * - IV de 12 octets par crypto aléatoire sécurisé, tag 128 bits (défaut) ;
 * - AAD contextuel `mcp-remote:v1:<tenantId>:<connectorId>` : un ciphertext
 *   ne peut être ni déplacé ni copié vers un autre couple (tenant, connecteur) ;
 * - keyId NON secret (résolution du keyring) ; rotation : le keyring garde
 *   la clé précédente pour re-chiffrer les données déjà écrites.
 *
 * Aucun log de secret ni de clé : les messages d'erreur ne contiennent aucune
 * donnée sensible (uniquement des noms de variables/labels techniques).
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { RemoteMcpSecretEnvelope, RemoteMcpSha256Hex } from './types.js';

export const REMOTE_MCP_SECRET_KEY_BYTES = 32;
export const REMOTE_MCP_SECRET_IV_BYTES = 12;
const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export type RemoteMcpCryptoErrorCode =
  | 'INVALID_KEY'
  | 'KEY_ID_REUSE'
  | 'AUTH_SECRET_REUSE'
  | 'UNKNOWN_KEY_ID'
  | 'DECRYPT_FAILED';

export class RemoteMcpCryptoError extends Error {
  readonly code: RemoteMcpCryptoErrorCode;

  constructor(message: string, code: RemoteMcpCryptoErrorCode) {
    super(message);
    this.name = "RemoteMcpCryptoError";
    this.code = code;
  }
}

export interface RemoteMcpKeyRingEntry {
  /** Identifiant non secret de la clé (journalisation/adressage sûrs). */
  readonly keyId: string;
  /** Exactement 32 octets (AES-256). */
  readonly key: Buffer;
}

export interface RemoteMcpKeyRingInput {
  readonly active: RemoteMcpKeyRingEntry;
  readonly previous?: RemoteMcpKeyRingEntry | undefined;
}

export interface RemoteMcpKeyRing {
  readonly active: RemoteMcpKeyRingEntry;
  /** Clé précédente : nécessaire à la rotation des données déjà chiffrées. */
  readonly previous: RemoteMcpKeyRingEntry | null;
}

export interface RemoteMcpCipherContext {
  readonly tenantId: string;
  readonly connectorId: string;
}

function entryFrom(
  keyId: unknown,
  key: unknown,
  label: string
): RemoteMcpKeyRingEntry {
  if (typeof keyId !== "string" || !KEY_ID_PATTERN.test(keyId)) {
    throw new RemoteMcpCryptoError(
      `${label} : keyId absent ou hors du format autorisé [A-Za-z0-9._-]{1,64}`,
      "INVALID_KEY"
    );
  }
  if (!Buffer.isBuffer(key)) {
    throw new RemoteMcpCryptoError(`${label} : clé absente ou non binaire`, "INVALID_KEY");
  }
  if (key.length !== REMOTE_MCP_SECRET_KEY_BYTES) {
    throw new RemoteMcpCryptoError(
      `${label} : la clé doit faire exactement ${REMOTE_MCP_SECRET_KEY_BYTES} octets`,
      "INVALID_KEY"
    );
  }
  if (key.every((byte) => byte === 0)) {
    throw new RemoteMcpCryptoError(`${label} : clé nulle refusée`, "INVALID_KEY");
  }
  return { keyId, key };
}

/** Construit un keyring strictement validé (ids distincts, clés distinctes). */
export function createRemoteMcpKeyRing(input: RemoteMcpKeyRingInput): RemoteMcpKeyRing {
  const active = entryFrom(input.active?.keyId, input.active?.key, "clé active");
  let previous: RemoteMcpKeyRingEntry | null = null;
  if (input.previous !== undefined && input.previous !== null) {
    previous = entryFrom(input.previous.keyId, input.previous.key, "clé précédente");
    if (previous.keyId === active.keyId) {
      throw new RemoteMcpCryptoError("keyId actif et clé précédente identiques", "KEY_ID_REUSE");
    }
    if (previous.key.equals(active.key)) {
      throw new RemoteMcpCryptoError("clé active et clé précédente identiques", "KEY_ID_REUSE");
    }
  }
  return { active, previous };
}

/** SHA-256 hexadécimal minuscule (empreintes de schéma d'outil/arguments). */
export function sha256Hex(value: string): RemoteMcpSha256Hex {
  return createHash('sha256').update(Buffer.from(value, 'utf8')).digest('hex');
}

/**
 * Décode une valeur base64 canonique d'une longueur exacte. Buffer.from est
 * tolérant : l'aller-retour identique exigé refuse les encodages approximatifs.
 */
function decodeStrictBase64(value: unknown, expectedBytes: number, label: string): Buffer {
  if (typeof value !== "string" || value.length === 0) {
    throw new RemoteMcpCryptoError(`${label} : absent`, "INVALID_KEY");
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== expectedBytes || decoded.toString("base64") !== value) {
    throw new RemoteMcpCryptoError(
      `${label} : base64 invalide ou longueur != ${expectedBytes} octets`,
      "INVALID_KEY"
    );
  }
  return decoded;
}

/** Version non-throw pour les contrôles optionnels (AUTH_SECRET, etc.). */
function tryDecodeStrictBase64(value: string, expectedBytes: number): Buffer | null {
  try {
    return decodeStrictBase64(value, expectedBytes, "contrôle");
  } catch {
    return null;
  }
}

/** Sources d'environnement injectables pour les tests (process.env par défaut). */
export interface RemoteMcpEnvSource {
  readonly AUTH_SECRET?: string | undefined;
  readonly VOLACO_MCP_REMOTE_KEY_ID?: string | undefined;
  readonly VOLACO_MCP_REMOTE_KEY?: string | undefined;
  readonly VOLACO_MCP_REMOTE_PREVIOUS_KEY_ID?: string | undefined;
  readonly VOLACO_MCP_REMOTE_PREVIOUS_KEY?: string | undefined;
}

/**
 * Charge le keyring depuis l'environnement. Variables requises :
 *   VOLACO_MCP_REMOTE_KEY_ID (keyId non secret, ex. "v1")
 *   VOLACO_MCP_REMOTE_KEY    (base64 canonique de 32 octets)
 * Optionnelles (rotation) :
 *   VOLACO_MCP_REMOTE_PREVIOUS_KEY_ID + VOLACO_MCP_REMOTE_PREVIOUS_KEY.
 * Aucune clé par défaut : si absent/incorrect, erreur explicite (fail-closed).
 */
export function loadRemoteMcpKeyringFromEnv(
  env: RemoteMcpEnvSource = process.env
): RemoteMcpKeyRing {
  const rawKeyId = env.VOLACO_MCP_REMOTE_KEY_ID;
  const rawKey = env.VOLACO_MCP_REMOTE_KEY;
  if (typeof rawKeyId !== "string" || rawKeyId.length === 0) {
    throw new RemoteMcpCryptoError(
      "VOLACO_MCP_REMOTE_KEY_ID requis (keyId non secret)",
      "INVALID_KEY"
    );
  }
  if (typeof rawKey !== "string" || rawKey.length === 0) {
    throw new RemoteMcpCryptoError(
      "VOLACO_MCP_REMOTE_KEY requis (base64 canonique de 32 octets, clé dédiée)",
      "INVALID_KEY"
    );
  }
  const active: RemoteMcpKeyRingEntry = {
    keyId: rawKeyId,
    key: decodeStrictBase64(rawKey, REMOTE_MCP_SECRET_KEY_BYTES, "VOLACO_MCP_REMOTE_KEY")
  };
  let previous: RemoteMcpKeyRingEntry | null = null;
  const rawPrevId = env.VOLACO_MCP_REMOTE_PREVIOUS_KEY_ID;
  const rawPrevKey = env.VOLACO_MCP_REMOTE_PREVIOUS_KEY;
  if (rawPrevKey !== undefined && rawPrevKey.length > 0) {
    if (typeof rawPrevId !== "string" || rawPrevId.length === 0) {
      throw new RemoteMcpCryptoError(
        "VOLACO_MCP_REMOTE_PREVIOUS_KEY_ID requis si PREVIOUS_KEY fournie",
        "INVALID_KEY"
      );
    }
    if (rawPrevKey === rawKey || rawPrevId === rawKeyId) {
      throw new RemoteMcpCryptoError(
        "Entrées actives/précédentes de keyring identiques",
        "KEY_ID_REUSE"
      );
    }
    previous = {
      keyId: rawPrevId,
      key: decodeStrictBase64(
        rawPrevKey,
        REMOTE_MCP_SECRET_KEY_BYTES,
        "VOLACO_MCP_REMOTE_PREVIOUS_KEY"
      )
    };
  }
  const ring = createRemoteMcpKeyRing({ active, previous: previous ?? undefined });

  // Refus du réemploi de AUTH_SECRET : valeur brute ou octets identiques.
  const authSecret = env.AUTH_SECRET;
  if (authSecret !== undefined && authSecret.length > 0) {
    const candidates: Buffer[] = [active.key];
    if (previous !== null) candidates.push(previous.key);
    if (authSecret === rawKey || (previous !== null && authSecret === rawPrevKey)) {
      throw new RemoteMcpCryptoError(
        "VOLACO_MCP_REMOTE_KEY : réutilisation de AUTH_SECRET interdite",
        "AUTH_SECRET_REUSE"
      );
    }
    const decodedAuth = tryDecodeStrictBase64(authSecret, REMOTE_MCP_SECRET_KEY_BYTES);
    if (decodedAuth !== null && candidates.some((k) => k.equals(decodedAuth))) {
      throw new RemoteMcpCryptoError(
        "VOLACO_MCP_REMOTE_KEY : octets issus de AUTH_SECRET interdits",
        "AUTH_SECRET_REUSE"
      );
    }
    for (const candidate of candidates) {
      if (
        authSecret.length === candidate.length &&
        candidate.equals(Buffer.from(authSecret, "utf8"))
      ) {
        throw new RemoteMcpCryptoError(
          "VOLACO_MCP_REMOTE_KEY : réutilisation de AUTH_SECRET interdite",
          "AUTH_SECRET_REUSE"
        );
      }
    }
  }
  return ring;
}

function aadFor(context: RemoteMcpCipherContext): Buffer {
  return Buffer.from(
    `mcp-remote:v1:${context.tenantId}:${context.connectorId}`,
    "utf8"
  );
}

/** Chiffrement AES-256-GCM scopé par couple (tenant, connecteur). */
export class RemoteMcpSecretCipher {
  private readonly keyRing: RemoteMcpKeyRing;

  constructor(keyRing: RemoteMcpKeyRing) {
    this.keyRing = keyRing;
  }

  get activeKeyId(): string {
    return this.keyRing.active.keyId;
  }

  encrypt(context: RemoteMcpCipherContext, plaintext: string): RemoteMcpSecretEnvelope {
    const iv = randomBytes(REMOTE_MCP_SECRET_IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.keyRing.active.key, iv);
    cipher.setAAD(aadFor(context));
    const ciphertext = Buffer.concat([
      cipher.update(Buffer.from(plaintext, "utf8")),
      cipher.final()
    ]);
    const authTag = cipher.getAuthTag().toString("base64");
    return {
      keyId: this.keyRing.active.keyId,
      iv: iv.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
      authTag
    };
  }

  decrypt(envelope: RemoteMcpSecretEnvelope, context: RemoteMcpCipherContext): string {
    let key: Buffer | null = null;
    if (typeof envelope.keyId === "string") {
      if (envelope.keyId === this.keyRing.active.keyId) {
        key = this.keyRing.active.key;
      } else if (
        this.keyRing.previous !== null &&
        envelope.keyId === this.keyRing.previous.keyId
      ) {
        key = this.keyRing.previous.key;
      }
    }
    if (key === null) {
      throw new RemoteMcpCryptoError("keyId absent ou inconnu du keyring", "UNKNOWN_KEY_ID");
    }
    const iv = decodeStrictBase64(envelope.iv, REMOTE_MCP_SECRET_IV_BYTES, "iv");
    const authTag = decodeStrictBase64(envelope.authTag, 16, "authTag");
    if (typeof envelope.ciphertext !== "string") {
      throw new RemoteMcpCryptoError("ciphertext absent de l'enveloppe", "DECRYPT_FAILED");
    }
    const ciphertext = Buffer.from(envelope.ciphertext, "base64");
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAAD(aadFor(context));
      decipher.setAuthTag(authTag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    } catch {
      throw new RemoteMcpCryptoError(
        "Déchiffrement refusé (AAD/GCM/corruption de l'enveloppe)",
        "DECRYPT_FAILED"
      );
    }
  }
}
