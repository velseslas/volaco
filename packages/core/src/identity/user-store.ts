/**
 * VibeCode Core — Authentification (ÉTAPE 4)
 *
 * UserStore : comptes utilisateurs persistants (scrypt pour les mots de passe,
 * un tenant dédié par utilisateur — CDC §37 Multi-Tenancy).
 * JWT : tokens signés HMAC-SHA256 (AUTH_SECRET — §35/§36 Security & AI
 * Security). Les tokens contiennent le rôle et le tenant : le header
 * X-User-Role côté client n'est plus une autorité.
 */

import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
import { dataFilePath, readJsonFile, writeJsonFileSync } from '../persistence/json-disk-cache.js';
import { ValidationError } from '../errors.js';

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
// ---------------------------------------------------------------------------

let ephemeralSecret: string | null = null;
let secretWarningEmitted = false;

function authSecret(): string {
  const explicit = process.env.AUTH_SECRET || process.env.VOLACO_API_KEY;
  if (explicit && explicit.length >= 16) return explicit;
  // Repli éphémère (dev uniquement) : les tokens ne survivent pas au
  // redémarrage si AUTH_SECRET n'est pas défini.
  if (!ephemeralSecret) {
    ephemeralSecret = randomBytes(32).toString('hex');
    if (!secretWarningEmitted) {
      secretWarningEmitted = true;
      console.warn('[VOLACO:AUTH] AUTH_SECRET non défini — tokens JWT éphémères (invalidés à chaque redémarrage). Définissez AUTH_SECRET en production.');
    }
  }
  return ephemeralSecret;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

export interface JwtPayload {
  sub: string;
  tenantId: string;
  role: string;
  email: string;
  iat: number;
  exp: number;
}

export function signToken(user: Pick<UserRecord, 'id' | 'tenantId' | 'role' | 'email'>, ttlSeconds = 60 * 60 * 24 * 30): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(JSON.stringify({
    sub: user.id,
    tenantId: user.tenantId,
    role: user.role,
    email: user.email,
    iat: now,
    exp: now + ttlSeconds
  } as JwtPayload));
  const mac = hmacSign(`${header}.${payload}`);
  return `${header}.${payload}.${mac}`;
}

function hmacSign(data: string): string {
  return createHmac('sha256', authSecret()).update(data).digest('base64url');
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
