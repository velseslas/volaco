/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-008)
 * Evidence Extraction & Security Sanitization Engine
 */

import type { UnderstandingEvidence, UnderstandingEvidenceKind } from '../types.js';

const SENSITIVE_PATH_PATTERNS = [
  /\.env(?:\..+)?$/i,
  /\.key$/i,
  /\.pem$/i,
  /id_rsa.*$/i,
  /credentials?\.json$/i,
  /secrets?\.json$/i,
  /token.*\.json$/i
];

const SECRET_PATTERNS = [
  /(?:api[_-]?key|secret|password|passwd|token|auth[_-]?header|bearer)\s*[:=]\s*["']?([^"\s]+)["']?/gi,
  /(?:ghp_[a-zA-Z0-9]{36}|sk-[a-zA-Z0-9]{32,})/g
];

export function isSensitivePath(filePath: string): boolean {
  if (!filePath) return false;
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  return SENSITIVE_PATH_PATTERNS.some(pat => pat.test(normalized));
}

export function maskSensitiveDetail(text: string): string {
  if (!text) return '';
  let sanitized = text;
  for (const pattern of SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, (match) => {
      return match.replace(/[:=]\s*["']?[^"\s]+["']?/, '="***MASKED_SECRET***"');
    });
  }
  return sanitized;
}

export function createEvidence(
  kind: UnderstandingEvidenceKind,
  source: string,
  detail: string,
  options?: {
    filePath?: string | undefined;
    lineStart?: number | undefined;
    lineEnd?: number | undefined;
    confidence?: number | undefined;
  }
): UnderstandingEvidence {
  const filePath = options?.filePath;
  if (filePath && isSensitivePath(filePath)) {
    return {
      kind,
      source,
      detail: '[REDACTED SENSITIVE FILE]',
      filePath: '[REDACTED]',
      confidence: 0.1
    };
  }

  return {
    kind,
    source,
    detail: maskSensitiveDetail(detail),
    filePath,
    lineStart: options?.lineStart,
    lineEnd: options?.lineEnd,
    confidence: options?.confidence ?? 0.8
  };
}
