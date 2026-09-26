import { createHash, randomUUID } from 'node:crypto';

export interface FileArtifact {
  path: string;
  content: string;
  size: number;
  hash: string;
  mimeType: string;
}

export interface TechnicalDecision {
  id: string;
  title: string;
  rationale: string;
  timestamp: Date;
  impact: string;
}

export interface ModificationProvenance {
  source: 'USER' | 'AI_AGENT' | 'SYSTEM_REPAIR';
  prompt?: string | undefined;
  triggerRequestId?: string | undefined;
}

export interface ApplicationRevision {
  id: string;
  tenantId: string;
  projectId: string;
  parentRevisionId?: string | undefined;
  revisionNumber: number;
  message: string;
  author: string;
  createdAt: Date;
  files: Record<string, FileArtifact>;
  decisions: TechnicalDecision[];
  provenance: ModificationProvenance;
}

export function computeSha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export function createFileArtifact(path: string, content: string, mimeType = 'text/plain'): FileArtifact {
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
  return {
    path: normalizedPath,
    content,
    size: Buffer.byteLength(content, 'utf8'),
    hash: computeSha256(content),
    mimeType
  };
}
