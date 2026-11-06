/**
 * VibeCode Core — Limitation d'abus MCP distant (LOT B, décision 5).
 *
 * Quotas PAR TENANT ET PAR UTILISATEUR, PAR MINUTE ET PAR TYPE D'OPÉRATION,
 * avec des plafonds initiaux CENTRALISÉS et configurables (variables
 * d'environnement) — jamais des constantes dispersées dans le code :
 *
 *   | Opération  | Défaut / tenant / min | Défaut / utilisateur / min |
 *   |---|---:|---:|
 *   | Discovery  | 60  | 30 |
 *   | Prepare    | 120 | 60 |
 *   | Call       | 90  | 45 |
 *   | Connecteurs| 30  | 15 |
 *
 * Comportement :
 *   - compteur à fenêtre fixe par minute, indexé par (tenant|user, opération) ;
 *   - la limite UTILISATEUR est plus restrictive que la limite TENANT ;
 *   - refus 429 explicite, journalisable/audité par l'appelant ;
 *   - si le mécanisme est indisponible (jamais ici, il est en mémoire), le
 *     comportement par défaut est SÛR (fail-closed applicatif côté route).
 */

export type RemoteMcpOperation = 'discovery' | 'prepare' | 'call' | 'connectors';

interface QuotaConfig {
  readonly tenantPerMinute: number;
  readonly userPerMinute: number;
}

const WINDOW_MS = 60_000;

function readQuota(envName: string, fallback: number): number {
  const raw = process.env[envName];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

/** Plafonds initiaux centralisés (surchargeables par environnement). */
export function remoteMcpQuota(op: RemoteMcpOperation): QuotaConfig {
  switch (op) {
    case 'discovery':
      return {
        tenantPerMinute: readQuota('VOLACO_MCP_QUOTA_DISCOVERY_TENANT', 60),
        userPerMinute: readQuota('VOLACO_MCP_QUOTA_DISCOVERY_USER', 30)
      };
    case 'prepare':
      return {
        tenantPerMinute: readQuota('VOLACO_MCP_QUOTA_PREPARE_TENANT', 120),
        userPerMinute: readQuota('VOLACO_MCP_QUOTA_PREPARE_USER', 60)
      };
    case 'call':
      return {
        tenantPerMinute: readQuota('VOLACO_MCP_QUOTA_CALL_TENANT', 90),
        userPerMinute: readQuota('VOLACO_MCP_QUOTA_CALL_USER', 45)
      };
    case 'connectors':
      return {
        tenantPerMinute: readQuota('VOLACO_MCP_QUOTA_CONNECTORS_TENANT', 30),
        userPerMinute: readQuota('VOLACO_MCP_QUOTA_CONNECTORS_USER', 15)
      };
  }
}

interface Bucket {
  count: number;
  windowStart: number;
}

export interface QuotaDecision {
  readonly allowed: boolean;
  /** 'tenant' | 'user' | null — quelle limite a été atteinte. */
  readonly scope: 'tenant' | 'user' | null;
  readonly limit: number;
  readonly retryAfterSeconds: number;
}

export class RemoteMcpRateLimiter {
  private readonly tenantBuckets = new Map<string, Bucket>();
  private readonly userBuckets = new Map<string, Bucket>();

  private consume(map: Map<string, Bucket>, key: string, max: number): { allowed: boolean; retryAfterSeconds: number } {
    const now = Date.now();
    const bucket = map.get(key);
    if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
      if (map.size > 10_000) {
        for (const [k, b] of map) {
          if (now - b.windowStart >= WINDOW_MS) map.delete(k);
        }
      }
      map.set(key, { count: 1, windowStart: now });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    bucket.count += 1;
    if (bucket.count > max) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((WINDOW_MS - (now - bucket.windowStart)) / 1000)) };
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }

  /**
   * Vérifie les quotas tenant PUIS utilisateur (la limite utilisateur est plus
   * restrictive). Consomme un jeton dans CHAQUE fenêtre seulement si autorisé,
   * afin qu'un refus tenant ne consomme pas le quota utilisateur.
   */
  public check(op: RemoteMcpOperation, tenantId: string, userId: string | undefined): QuotaDecision {
    const quota = remoteMcpQuota(op);
    const tenantKey = `${tenantId}:${op}`;
    const now = Date.now();
    const tenantBucket = this.tenantBuckets.get(tenantKey);
    if (tenantBucket && now - tenantBucket.windowStart < WINDOW_MS && tenantBucket.count >= quota.tenantPerMinute) {
      return {
        allowed: false,
        scope: 'tenant',
        limit: quota.tenantPerMinute,
        retryAfterSeconds: Math.max(1, Math.ceil((WINDOW_MS - (now - tenantBucket.windowStart)) / 1000))
      };
    }
    if (typeof userId === 'string' && userId.length > 0) {
      const userKey = `${tenantId}:${userId}:${op}`;
      const userBucket = this.userBuckets.get(userKey);
      if (userBucket && now - userBucket.windowStart < WINDOW_MS && userBucket.count >= quota.userPerMinute) {
        return {
          allowed: false,
          scope: 'user',
          limit: quota.userPerMinute,
          retryAfterSeconds: Math.max(1, Math.ceil((WINDOW_MS - (now - userBucket.windowStart)) / 1000))
        };
      }
      const userDecision = this.consume(this.userBuckets, userKey, quota.userPerMinute);
      if (!userDecision.allowed) {
        return { allowed: false, scope: 'user', limit: quota.userPerMinute, retryAfterSeconds: userDecision.retryAfterSeconds };
      }
    }
    const tenantDecision = this.consume(this.tenantBuckets, tenantKey, quota.tenantPerMinute);
    if (!tenantDecision.allowed) {
      return { allowed: false, scope: 'tenant', limit: quota.tenantPerMinute, retryAfterSeconds: tenantDecision.retryAfterSeconds };
    }
    return { allowed: true, scope: null, limit: quota.tenantPerMinute, retryAfterSeconds: 0 };
  }

  /** Usage tests uniquement. */
  public clear(): void {
    this.tenantBuckets.clear();
    this.userBuckets.clear();
  }
}

export const remoteMcpRateLimiter = new RemoteMcpRateLimiter();
