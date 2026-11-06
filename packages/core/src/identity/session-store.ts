/**
 * VibeCode Core — Réseau de sessions JWT révocables (LOT B, décision 3).
 *
 * Le secret JWT est désormais dédié (VOLACO_JWT_SECRET) ; pour rendre la
 * révocation EFFECTIVE côté serveur, chaque utilisateur porte une version de
 * session (`sessionVersion`, monotone). Un JWT embarque `sv` = la version au
 * moment de l'émission ; toute émission ultérieure (logout, désactivation de
 * compte, changement de mot de passe) incrémente la version persistée, ce qui
 * invalide immédiatement tous les jetons émis avec une version antérieure.
 *
 * Persistance : document unique `jwt-sessions` (couche json-disk-cache → SQLite),
 * borné (MAX_REVOKED_JTI) ; les JTI révoqués individuellement sont conservés
 * pour un logout ciblé (une déconnexion n'invalide que la session visée).
 *
 * Contrat de sécurité :
 *   - la révocation est vérifiée CÔTÉ SERVEUR à chaque requête authentifiée
 *     (cf. middleware/auth.ts) — un JWT signé et non expiré NE PASSE PLUS
 *     après révocation ;
 *   - la révocation ne dépend PAS du secret de signature : elle s'applique
 *     après vérification HMAC, donc un porteur de la clé API ne peut pas
 *     forger un jeton OWNER (la clé API n'a pas d'identité utilisateur et
 *     n'émet aucune session) ;
 *   - TTL par défaut 12h, plafond recommandé 24h, configurable via
 *     JWT_DEFAULT_TTL_SECONDS / variable d'environnement.
 */

import { dataFilePath, readJsonFile, writeJsonFileSync } from '../persistence/json-disk-cache.js';

/** Nombre maximal de JTI révoqués conservés (FIFO, les plus anciens sortent). */
export const MAX_REVOKED_JTI = 5_000;

interface SessionDoc {
  /** userId → version de session courante (monotone croissante). */
  versions: Record<string, number>;
  /** jti révoqués individuellement (logout ciblé). */
  revokedJti: string[];
}

const EMPTY_DOC: SessionDoc = { versions: {}, revokedJti: [] };

export class SessionRevocationStore {
  private doc: SessionDoc = { versions: {}, revokedJti: [] };
  private readonly filePath: string | undefined;

  constructor(persist: boolean = true) {
    if (persist) {
      this.filePath = dataFilePath('jwt-sessions');
      const raw = readJsonFile<SessionDoc>(this.filePath, EMPTY_DOC);
      if (raw && typeof raw === 'object') {
        this.doc = {
          versions: raw.versions && typeof raw.versions === 'object' ? raw.versions : {},
          revokedJti: Array.isArray(raw.revokedJti) ? raw.revokedJti.filter((v) => typeof v === 'string') : []
        };
      }
    }
  }

  private persist(): void {
    if (!this.filePath) return;
    writeJsonFileSync(this.filePath, this.doc);
  }

  /** Version de session courante d'un utilisateur (0 par défaut = jamais révoqué). */
  public currentVersion(userId: string): number {
    const v = this.doc.versions[userId];
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
  }

  /**
   * Révoque TOUTES les sessions d'un utilisateur (logout global, désactivation
   * de compte, changement de mot de passe) : incrémente la version de session.
   * Retourne la nouvelle version.
   */
  public revokeUser(userId: string): number {
    const next = this.currentVersion(userId) + 1;
    this.doc.versions[userId] = next;
    this.persist();
    return next;
  }

  /** Révoque un jeton précis (logout d'un appareil) par son JTI. */
  public revokeJti(jti: string): void {
    if (typeof jti !== 'string' || jti.length === 0) return;
    if (this.doc.revokedJti.includes(jti)) return;
    this.doc.revokedJti.push(jti);
    if (this.doc.revokedJti.length > MAX_REVOKED_JTI) {
      this.doc.revokedJti.splice(0, this.doc.revokedJti.length - MAX_REVOKED_JTI);
    }
    this.persist();
  }

  /** Un JTI a-t-il été révoqué individuellement ? */
  public isJtiRevoked(jti: string | undefined): boolean {
    if (typeof jti !== 'string' || jti.length === 0) return false;
    return this.doc.revokedJti.includes(jti);
  }

  /**
   * Le jeton est-il valide au regard de la révocation ? Un jeton sans `sv`
   * (émis avant la migration) est REFUSÉ : la migration invalide
   * effectivement les JWT émis avec l'ancien mécanisme.
   */
  public isTokenStillValid(userId: string, sv: number | undefined, jti: string | undefined): boolean {
    if (typeof sv !== 'number' || !Number.isFinite(sv)) return false;
    if (sv < this.currentVersion(userId)) return false;
    if (this.isJtiRevoked(jti)) return false;
    return true;
  }

  /** Usage tests uniquement. */
  public clear(): void {
    this.doc = { versions: {}, revokedJti: [] };
    this.persist();
  }
}

export const sessionRevocationStore = new SessionRevocationStore(true);
