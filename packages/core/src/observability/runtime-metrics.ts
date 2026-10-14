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

// P0-masse — RENDUS CHROMIUM BORNÉS : /render/preview (1 navigateur) et
// /repair (jusqu'à 3 rendus + LLM) contournaient le sémaphore IA. Compteur
// SÉPARÉ (tokens ≠ navigateurs : saturer l'un ne bloque pas l'autre).
// VOLACO_MAX_CONCURRENT_RENDER (défaut 2 : ~1 Go pire cas).
let activeRender = 0;
let peakRender = 0;
let totalRenderStarted = 0;

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

export function maxConcurrentRender(): number {
  return parseInt(process.env.VOLACO_MAX_CONCURRENT_RENDER || '2', 10) || 2;
}

export function tryAcquireRenderSlot(): boolean {
  const max = maxConcurrentRender();
  if (activeRender >= max) return false;
  activeRender += 1;
  totalRenderStarted += 1;
  if (activeRender > peakRender) peakRender = activeRender;
  return true;
}

export function releaseRenderSlot(): void {
  if (activeRender > 0) activeRender -= 1;
}

export interface RuntimeSnapshot {
  uptimeSeconds: number;
  heapUsedMb: number;
  rssMb: number;
  activeAi: number;
  peakAi: number;
  totalAiStarted: number;
  maxConcurrentAi: number;
  activeRender: number;
  peakRender: number;
  totalRenderStarted: number;
  maxConcurrentRender: number;
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
    maxConcurrentAi: max,
    activeRender,
    peakRender,
    totalRenderStarted,
    maxConcurrentRender: maxConcurrentRender()
  };
}
