/**
 * C3.1 — Types pour les connecteurs MCP distants (transport URL-only).
 *
 * Périmètre volontairement borné :
 * - types uniquement : aucun transport HTTP/TLS, aucun appel réseau ici ;
 * - pas de réutilisation du cache JSON générique (clé non tenant-isolée) ;
 * - aucun secret en clair dans le modèle persistant : l'enveloppe chiffrée ne
 *   transporte que iv + ciphertext + authTag + keyId (keyId NON secret) ;
 * - chaque enregistrement porte tenantId ; l'isolation est garantie par le
 *   store (C3.2 : toutes les routes filtrent par tenantId côté serveur).
 */

export type RemoteMcpTransport = 'url';

export type RemoteMcpToolApprovalStatus = 'APPROVED' | 'REVOKED';

/** SHA-256 hexadécimal minuscule (64 caractères). */
export type RemoteMcpSha256Hex = string;

export interface RemoteMcpToolPolicy {
  readonly tenantId: string;
  readonly connectorId: string;
  readonly toolName: string;
  /** SHA-256 du schéma d'outil déclaré par le serveur distant au moment de l'approbation. */
  readonly schemaSha256: RemoteMcpSha256Hex;
  readonly status: RemoteMcpToolApprovalStatus;
  readonly approvedBy: string;
  readonly approvedAt: string;
  readonly updatedAt: string;
}

/**
 * Enveloppe chiffrée AES-256-GCM. `keyId` est non secret (résolution du
 * keyring côté serveur). Le plaintext n'apparaît JAMAIS dans ce type.
 */
export interface RemoteMcpSecretEnvelope {
  readonly keyId: string;
  readonly iv: string;
  readonly ciphertext: string;
  readonly authTag: string;
}

/** Métadonnées non secrètes du secret rattaché à un connecteur. */
export interface RemoteMcpSecretMeta {
  readonly keyId: string;
  readonly encryptedAt: string;
}

/**
 * MCP-C3.1-CONFIG-STORE — Résultat NON SECRET du dernier test de connexion
 * persisté pour un connecteur tenant. Horodatage ISO-8601, statut binaire,
 * détail borné (512 unités de code) et sans caractères de contrôle. Aucun
 * secret, aucun identifiant utilisateur ; l'éligibilité réseau de l'URL reste
 * du ressort de la couche client (C3.3), ce type ne porte que le résultat.
 */
export type RemoteMcpLastTestStatus = 'OK' | 'FAILED';

export interface RemoteMcpLastTest {
  readonly at: string;
  readonly status: RemoteMcpLastTestStatus;
  readonly detail: string | null;
}

export interface RemoteMcpConnectorRecord {
  readonly tenantId: string;
  readonly connectorId: string;
  readonly name: string;
  readonly url: string;
  readonly transport: RemoteMcpTransport;
  readonly enabled: boolean;
  readonly secretMeta: RemoteMcpSecretMeta | null;
  readonly toolPolicies: readonly RemoteMcpToolPolicy[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Confirmation ponctuelle, utilisée une seule fois (anti-rejeu), liée au
 * tenant, à l'utilisateur, au connecteur, au nom d'outil, au hash du schéma
 * d'outil et au hash des arguments canoniques de l'appel.
 */
export interface RemoteMcpConfirmationRecord {
  readonly tenantId: string;
  readonly userId: string;
  readonly confirmationId: string;
  readonly connectorId: string;
  readonly toolName: string;
  readonly schemaSha256: RemoteMcpSha256Hex;
  readonly argsSha256: RemoteMcpSha256Hex;
  /** Échéance en millisecondes epoch (cap configuré par le store). */
  readonly expiresAt: number;
  /** Millisecondes epoch de consommation ; null tant que non consommée. */
  readonly consumedAt: number | null;
}
