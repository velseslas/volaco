/**
 * VibeCode Core — Runtime Metrics (P5)
 *
 * Observabilité temps réel du process : mémoire, opérations IA actives
 * (générations/éditions en cours), pic de concurrence, total démarré.
 * Utilisé par le semaphore de concurrence (P5) et la route /api/v1/metrics.
 */

import { memoryUsage } from 'node:process';

let activeAi = 0;
let peakAi = 0;
let totalAiStarted = 0;

/**
 * Semaphore d'entrée pour les opérations IA lourdes (génération HTML,
 * projets React, éditions, images). Retourne false si la limite de
 * concurrence est atteinte — l'appelant répond 503 + Retry-After.
 * VOLACO_MAX_CONCURRENT_AI (défaut 3).
 */
export function tryAcquireAiSlot(): boolean {
  const max = parseInt(process.env.VOLACO_MAX_CONCURRENT_AI || '3', 10) || 3;
  if (activeAi >= max) return false;
  activeAi += 1;
  totalAiStarted += 1;
  if (activeAi > peakAi) peakAi = activeAi;
  return true;
}

export function releaseAiSlot(): void {
  if (activeAi > 0) activeAi -= 1;
}

export interface RuntimeSnapshot {
  uptimeSeconds: number;
  heapUsedMb: number;
  rssMb: number;
  activeAi: number;
  peakAi: number;
  totalAiStarted: number;
  maxConcurrentAi: number;
}

export function runtimeSnapshot(): RuntimeSnapshot {
  const mem = memoryUsage();
  const max = parseInt(process.env.VOLACO_MAX_CONCURRENT_AI || '3', 10) || 3;
  return {
    uptimeSeconds: Math.floor(process.uptime()),
    heapUsedMb: Math.round((mem.heapUsed / 1048576) * 10) / 10,
    rssMb: Math.round((mem.rss / 1048576) * 10) / 10,
    activeAi,
    peakAi,
    totalAiStarted,
    maxConcurrentAi: max
  };
}
