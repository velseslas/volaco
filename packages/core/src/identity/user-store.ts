/**
 * VibeCode Core — Authentification (ÉTAPE 4)
 *
 * UserStore : comptes utilisateurs persistants (scrypt pour les mots de passe,
 * un tenant dédié par utilisateur — CDC §37 Multi-Tenancy).
 * JWT : tokens signés HMAC-SHA256 avec un secret JWT dédié (VOLACO_JWT_SECRET
 * — LOT B,12h). Les tokens contiennent le rôle et le tenant : le header
 * X-User-Role côté client n'est plus une autorité.
 *
 * LOT B (Phase 2, décision 2) — Secret JWT P0 :
 *   - le secret de signature est DISTINCT de la clé API et de AUTH_SECRET.
 *     Un secret JWT non conforme (absence, longueur < 256 bits, valeur nulle,
 *     ou octets égaux à VOLACO_API_KEY) est REFUSÉ au démarrage du service.
 *   - aucun secret éphémère généré silencieusement ; les JWT émis avant la
 *     migration (AUTH_SECRET || VOLACO_API_KEY) ne restent PAS valides.
 *   - procédure de rotation documentée dans mcp-lot-b-report.md §2/§5.3.
 */

import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
import { dataFilePath, readJsonFile, writeJsonFileSync } from '../persistence/json-disk-cache.js';
import { ValidationError } from '../errors.js';
import { sessionRevocationStore } from './session-store.js';

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  tenantId: string;
  role: 'OWNER' | 'ADMIN' | 'ENGINEER' | 'VIEWER';
  passwordSalt: string;
  passwordHash: string;
  createdAt: string;
}

const USERS_MAX = 10_000;

export class UserStore {
  private users: Record<string, UserRecord> = {};
  private readonly filePath = dataFilePath('users');

  constructor() {
    const loaded = readJsonFile<Record<string, UserRecord>>(this.filePath, {});
    if (loaded && typeof loaded === 'object') this.users = loaded;
  }

  private persist(): void {
    writeJsonFileSync(this.filePath, this.users);
  }

  private async hashPassword(password: string, salt: string): Promise<string> {
    const derived = (await scryptAsync(password, salt, 64)) as Buffer;
    return derived.toString('hex');
  }

  public findByEmail(email: string): UserRecord | undefined {
    const normalized = email.trim().toLowerCase();
    return Object.values(this.users).find((u) => u.email === normalized);
  }

  /**
   * Espace utilisateur (GET /api/v1/auth/me) — retrouver un compte par
   * identifiant JWT (payload.sub). Le record complet reste interne au store ;
   * l'appelant HTTP le publie UNIQUEMENT via `publicUser` (jamais les champs
   * secrets passwordSalt/passwordHash).
   */
  public findById(id: string): UserRecord | undefined {
    return this.users[id];
  }

  public async createUser(email: string, password: string, name?: string): Promise<UserRecord> {
    const normalized = (email || '').trim().toLowerCase();
    if (!normalized || !normalized.includes('@')) {
      throw new ValidationError('Un email valide est obligatoire');
    }
    if (!password || password.length < 8) {
      throw new ValidationError('Le mot de passe doit contenir au moins 8 caractères');
    }
    if (this.findByEmail(normalized)) {
      throw new ValidationError('Un compte existe déjà pour cet email');
    }
    // LOT B (décision 5) — application effective de USERS_MAX : le contrôle de
    // capacité fait partie de la même passe de validation, AVANT tout await
    // (le hash scrypt est la seule opération asynchrone, elle vient après).
    if (Object.keys(this.users).length >= USERS_MAX) {
      throw new ValidationError(`Limite de comptes atteinte (${USERS_MAX}).`);
    }

    const id = 'usr_' + randomBytes(8).toString('hex');
    const salt = randomBytes(16).toString('hex');
    const user: UserRecord = {
      id,
      email: normalized,
      name: (name || normalized.split('@')[0] || normalized || 'utilisateur').trim(),
      // Un tenant dédié par utilisateur : isolation par défaut (§37)
      tenantId: 'ten-u' + randomBytes(6).toString('hex'),
      role: 'OWNER',
      passwordSalt: salt,
      passwordHash: await this.hashPassword(password, salt),
      createdAt: new Date().toISOString()
    };
    this.users[id] = user;
    this.persist();
    return user;
  }

  /** Révoque toutes les sessions d'un utilisateur (logout global / désactivation). */
  public revokeSessions(userId: string): number {
    return sessionRevocationStore.revokeUser(userId);
  }

  public async verifyCredentials(email: string, password: string): Promise<UserRecord | null> {
    const user = this.findByEmail(email);
    if (!user) return null;
    const candidate = await this.hashPassword(password || '', user.passwordSalt);
    const expected = Buffer.from(user.passwordHash, 'hex');
    const given = Buffer.from(candidate, 'hex');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    return user;
  }
}

export const userStore = new UserStore();

// ---------------------------------------------------------------------------
// JWT HMAC-SHA256 — dépend uniquement de node:crypto (pas de dépendance npm)
// LOT B (Phase 2, décision 2) — Secret JWT P0 :
//   - secret dédié VOLACO_JWT_SECRET (base64 canonique de ≥ 32 octets) ;
//   - aucun fallback vers VOLACO_API_KEY ni AUTH_SECRET ;
//   - aucun secret éphémère généré silencieusement ;
//   - refus de démarrage si absent/invalide ;
//   - le secret n'est jamais journalisé.
// ---------------------------------------------------------------------------

const JWT_SECRET_BYTES_MIN = 32;

function decodeSecretBytes(value: unknown): Buffer | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length < JWT_SECRET_BYTES_MIN || decoded.toString('base64') !== value) return null;
  if (decoded.every((byte) => byte === 0)) return null;
  return decoded;
}

function envSecretBytes(): Buffer | null {
  const raw = process.env.VOLACO_JWT_SECRET;
  return decodeSecretBytes(raw);
}

function apiKeyBytes(): Buffer | null {
  const raw = process.env.VOLACO_API_KEY;
  if (typeof raw !== 'string' || raw.length === 0) return null;
  const decoded = Buffer.from(raw, 'base64');
  if (decoded.length >= JWT_SECRET_BYTES_MIN && decoded.toString('base64') === raw) return decoded;
  return Buffer.from(raw, 'utf8');
}

export function getJwtSecretBytes(): Buffer {
  const secret = envSecretBytes();
  if (secret === null) {
    throw new Error(
      'Secret JWT VOLACO_JWT_SECRET absent ou invalide (base64 canonique de ≥ 32 octets, distinct de VOLACO_API_KEY). ' +
      'Le service refuse de démarrer : aucun secret éphémère n’est généré. ' +
      'Rotation documentée dans mcp-lot-b-report.md §2/§5.3.'
    );
  }
  const apiKey = apiKeyBytes();
  if (apiKey !== null && apiKey.equals(secret)) {
    throw new Error('VOLACO_JWT_SECRET réutilise les octets de VOLACO_API_KEY — interdit.');
  }
  return secret;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

export interface JwtPayload {
  sub: string;
  tenantId: string;
  role: string;
  email: string;
  /** Identifiant unique du token (révocation métier B3). */
  jti?: string | undefined;
  /** Epoch/version de session (révocation métier B3). */
  sv?: number | undefined;
  iat: number;
  exp: number;
}

/** Durée de vie par défaut d'un JWT (B3: 12h, plafond recommandé 24h). */
export const JWT_DEFAULT_TTL_SECONDS = 12 * 60 * 60;
export const JWT_MAX_TTL_SECONDS = 24 * 60 * 60;

function clampTtlSeconds(ttlSeconds: number): number {
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) return JWT_DEFAULT_TTL_SECONDS;
  return Math.min(Math.floor(ttlSeconds), JWT_MAX_TTL_SECONDS);
}

export function signToken(
  user: Pick<UserRecord, 'id' | 'tenantId' | 'role' | 'email'>,
  ttlSeconds: number = JWT_DEFAULT_TTL_SECONDS,
  sessionVersion: number = 0
): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(JSON.stringify({
    sub: user.id,
    tenantId: user.tenantId,
    role: user.role,
    email: user.email,
    jti: randomBytes(16).toString('hex'),
    sv: Number.isFinite(sessionVersion) ? sessionVersion : 0,
    iat: now,
    exp: now + clampTtlSeconds(ttlSeconds)
  } as JwtPayload));
  const mac = hmacSign(`${header}.${payload}`);
  return `${header}.${payload}.${mac}`;
}

function hmacSign(data: string): string {
  return createHmac('sha256', getJwtSecretBytes()).update(data).digest('base64url');
}

export function verifyToken(token: string): JwtPayload | null {
  if (typeof token !== 'string' || token.split('.').length !== 3) return null;
  const [header, payload, mac] = token.split('.');
  if (!header || !payload || !mac) return null;
  const expected = hmacSign(`${header}.${payload}`);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as JwtPayload;
    if (!parsed.sub || !parsed.tenantId || typeof parsed.exp !== 'number') return null;
    if (parsed.exp <= Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}
