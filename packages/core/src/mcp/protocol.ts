/**
 * VibeCode Core — MCP Protocol (P3)
 *
 * Types et codec du Model Context Protocol : JSON-RPC 2.0 délimité par
 * nouvelles lignes sur stdio (transport standard MCP). Le protocole est
 * implémenté manuellement (zéro dépendance) : handshake initialize,
 * notifications/initialized, tools/list, tools/call — conforme au
 * standard MCP 2024-11-05 dans le périmètre utilisé.
 */

export const MCP_PROTOCOL_VERSION = '2024-11-05';

/** Outil exposé par un serveur MCP (format tools/list). */
export interface McpToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

/** Résultat d'un tools/call au format MCP (content typé texte). */
export interface McpToolCallResult {
  readonly content: ReadonlyArray<{ type: 'text'; text: string }>;
  readonly isError?: boolean;
}

interface JsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id?: number;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

/** Sérialise une requête JSON-RPC en ligne stdio (newline-delimited). */
export function encodeRequest(id: number, method: string, params?: Record<string, unknown>): string {
  const req: JsonRpcRequest = { jsonrpc: '2.0', id, method, ...(params ? { params } : {}) };
  return JSON.stringify(req);
}

/** Sérialise une notification (sans id — pas de réponse attendue). */
export function encodeNotification(method: string, params?: Record<string, unknown>): string {
  const note: JsonRpcRequest = { jsonrpc: '2.0', method, ...(params ? { params } : {}) };
  return JSON.stringify(note);
}

export interface JsonRpcSuccess {
  readonly jsonrpc: '2.0';
  readonly id: number;
  readonly result: Record<string, unknown>;
}

export interface JsonRpcError {
  readonly jsonrpc: '2.0';
  readonly id: number | null;
  readonly error: { code: number; message: string };
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;

/** Parse une ligne JSON-RPC ; null si non parsable. */
export function decodeMessage(line: string): JsonRpcResponse | JsonRpcRequest | null {
  try {
    return JSON.parse(line) as JsonRpcResponse | JsonRpcRequest;
  } catch {
    return null;
  }
}

/** Réponse de succès JSON-RPC (ligne stdio). */
export function encodeSuccess(id: number, result: Record<string, unknown>): string {
  return JSON.stringify({ jsonrpc: '2.0', id, result } satisfies JsonRpcSuccess);
}

/** Réponse d'erreur JSON-RPC (ligne stdio). */
export function encodeError(id: number | null, code: number, message: string): string {
  return JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
}

/** Codes d'erreur JSON-RPC utilisés. */
export const MCP_ERROR = {
  PARSE: -32700,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603
} as const;

/** Enveloppe un texte au format MCP content. */
export function textResult(text: string, isError = false): McpToolCallResult {
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) };
}
