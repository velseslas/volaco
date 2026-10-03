/**
 * VibeCode Core — Client MCP stdio (P3)
 *
 * Client MCP minimal et réel : spawn le processus serveur, handshake
 * initialize, notifications/initialized, tools/list, tools/call avec
 * corrélation par id, timeout par appel, fermeture propre.
 *
 * Le transport est newline-delimited JSON sur stdio (protocole MCP) —
 * identique au serveur project-server.ts.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import {
  decodeMessage,
  encodeNotification,
  encodeRequest,
  type McpToolDefinition
} from './protocol.js';

export interface McpClientOptions {
  readonly command: string;
  readonly args?: readonly string[];
  /** Timeout par défaut d'un appel (ms, défaut 10 000). */
  readonly timeoutMs?: number;
}

export class McpStdioClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private buffer = '';
  private readonly defaultTimeoutMs: number;

  constructor(private readonly options: McpClientOptions) {
    this.defaultTimeoutMs = options.timeoutMs ?? 10000;
  }

  /** Démarre le processus serveur et effectue le handshake initialize. */
  public async connect(serverInfo?: { clientName?: string; clientVersion?: string }): Promise<Record<string, unknown>> {
    this.child = spawn(this.options.command, this.options.args ?? [], { stdio: ['pipe', 'pipe', 'pipe'] });

    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => {
      this.buffer += chunk;
      let idx;
      while ((idx = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, idx).trim();
        this.buffer = this.buffer.slice(idx + 1);
        if (line.length === 0) continue;

        const msg = decodeMessage(line);
        if (!msg || !('id' in msg) || msg.id === null) continue; // notification — ignorée

        const pendingEntry = this.pending.get(msg.id);
        if (!pendingEntry) continue;
        clearTimeout(pendingEntry.timer);
        this.pending.delete(msg.id);

        if ('error' in msg && msg.error) {
          pendingEntry.reject(new Error('MCP error ' + msg.error.code + ': ' + msg.error.message));
        } else if ('result' in msg) {
          pendingEntry.resolve(msg.result);
        }
      }
    });

    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', () => undefined); // les logs serveur sont ignorés (protocole = stdout)

    this.child.on('exit', () => {
      this.child = null;
      for (const [id, pendingEntry] of this.pending) {
        clearTimeout(pendingEntry.timer);
        pendingEntry.reject(new Error('Serveur MCP terminé avant la réponse (id ' + id + ')'));
      }
      this.pending.clear();
    });

    // Handshake MCP : initialize + notification initialized
    const result = await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: serverInfo?.clientName ?? 'volaco-core', version: serverInfo?.clientVersion ?? '1.0.0' }
    });
    this.child.stdin.write(encodeNotification('notifications/initialized') + '\n');
    return result;
  }

  /** Liste les outils exposés par le serveur. */
  public async listTools(): Promise<readonly McpToolDefinition[]> {
    const result = await this.request('tools/list');
    return (result.tools as readonly McpToolDefinition[]) ?? [];
  }

  /** Appelle un outil ; renvoie le texte du content MCP. */
  public async callTool(name: string, args: Record<string, unknown> = {}, timeoutMs?: number): Promise<string> {
    const result = await this.request('tools/call', { name, arguments: args }, timeoutMs);
    const content = result.content as ReadonlyArray<{ type: string; text?: string }> | undefined;
    const text = (content ?? []).map((c) => c.text ?? '').join('\n');
    const isError = (result as { isError?: boolean }).isError === true;
    if (isError) throw new Error(text || 'Erreur MCP sans message');
    return text;
  }

  /** Termine le serveur proprement. */
  public close(): void {
    if (this.child) {
      this.child.kill();
      this.child = null;
    }
  }

  private request(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<Record<string, unknown>> {
    if (!this.child) {
      return Promise.reject(new Error('Client MCP non connecté'));
    }
    const id = this.nextId;
    this.nextId += 1;
    const limit = timeoutMs ?? this.defaultTimeoutMs;

    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Timeout MCP (' + limit + ' ms) : ' + method));
      }, limit);
      this.pending.set(id, { resolve, reject, timer });
      this.child!.stdin.write(encodeRequest(id, method, params) + '\n');
    });
  }

}
