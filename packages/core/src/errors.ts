export type ErrorCode =
  | 'INTERNAL_ERROR'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'BAD_REQUEST'
  | 'PAYLOAD_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'PROJECT_BUSY'
  /* C3.2-B — connecteurs MCP distants : erreurs normalisées (additif) */
  /* C3.2-B2 — mutation concurrente du connecteur pendant une demande (TOCTOU
     gardé) : l'URL a changé entre l'interrogation et le commit → refus 409. */
  | 'MCP_REMOTE_DRIFT'
  | 'MCP_REMOTE_UNREACHABLE'
  | 'MCP_REMOTE_TIMEOUT'
  | 'MCP_REMOTE_CONFIG'
  /* Lot A — gouvernance MCP intégrée : état de confirmation invalide
     (inconnue / expirée / rejouée / empreinte divergente) — 409 stable,
     raison fermée portée par l'audit, jamais par le message HTTP. */
  | 'MCP_BUILTIN_DRIFT';

export interface ErrorDetails {
  code: ErrorCode;
  message: string;
  statusCode: number;
  requestId?: string | undefined;
  context?: Record<string, unknown> | undefined;
}

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly requestId?: string | undefined;
  public readonly context?: Record<string, unknown> | undefined;

  constructor(
    message: string,
    code: ErrorCode = 'INTERNAL_ERROR',
    statusCode = 500,
    context?: Record<string, unknown> | undefined,
    requestId?: string | undefined
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.context = context;
    this.requestId = requestId;
  }

  toJSON(): { error: ErrorDetails } {
    const details: ErrorDetails = {
      code: this.code,
      message: this.message,
      statusCode: this.statusCode
    };
    if (this.requestId !== undefined) {
      details.requestId = this.requestId;
    }
    if (this.context !== undefined) {
      details.context = this.context;
    }
    return { error: details };
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, requestId?: string | undefined) {
    super(`Ressource non trouvÃ©e : ${resource}`, 'NOT_FOUND', 404, { resource }, requestId);
    this.name = 'NotFoundError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentification requise : token Bearer manquant ou invalide', requestId?: string | undefined) {
    super(message, 'UNAUTHORIZED', 401, {}, requestId);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'AccÃ¨s interdit : droits insuffisants', requestId?: string | undefined) {
    super(message, 'FORBIDDEN', 403, {}, requestId);
    this.name = 'ForbiddenError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string, context?: Record<string, unknown> | undefined, requestId?: string | undefined) {
    super(message, 'VALIDATION_ERROR', 400, context, requestId);
    this.name = 'ValidationError';
  }
}
