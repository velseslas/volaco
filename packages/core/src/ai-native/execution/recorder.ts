/**
 * ExecutionRecorder — point de passage unique entre le flux de génération,
 * le SSE et le store d'événements (CDC §16 : un seul transport, une seule
 * source de vérité).
 *
 * Principe : chaque frame SSE « milestone » passe par `frame()`. Si un
 * événement est fourni, il est d'abord enregistré (seq, phase, status),
 * puis la frame part enrichie de { executionId, seq, phase, status } —
 * champs ADDITIFS uniquement, le contrat SSE existant n'est pas modifié.
 * Les frames haute fréquence (token, chat) passent par `frame()` sans
 * événement : elles ne portent que l'executionId.
 */

import type { ExecutionEventStore } from './store.js';
import type { ExecutionEvent } from './types.js';
import { normalizeExecutionEvent } from './activity.js';

export interface RecordableEvent {
  type: ExecutionEvent['type'];
  phase: ExecutionEvent['phase'];
  status: ExecutionEvent['status'];
  title: string;
  detail?: Record<string, unknown>;
  durationMs?: number;
}

export class ExecutionRecorder {
  constructor(
    private readonly store: ExecutionEventStore,
    public readonly executionId: string,
    private readonly send: (data: Record<string, unknown>) => void
  ) {}

  /**
   * Envoie une frame SSE ; enregistre l'événement si fourni. Les frames
   * « milestone » portent la vue normalisée `activity` (LOT B) : le client
   * du Live Activity Stream rend l'activité SANS posséder son propre
   * normalisateur — une seule source de vérité, côté serveur.
   */
  public frame(data: Record<string, unknown>, event?: RecordableEvent): void {
    if (event) {
      const stored = this.store.appendEvent(this.executionId, event);
      this.send({
        ...data,
        executionId: this.executionId,
        seq: stored.seq,
        phase: stored.phase,
        status: stored.status,
        activity: normalizeExecutionEvent(stored)
      });
      return;
    }
    this.send({ ...data, executionId: this.executionId });
  }
}
