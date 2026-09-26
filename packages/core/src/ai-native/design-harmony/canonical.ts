/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-012)
 * Design Harmony Engine - Canonical & Mathematical Utilities
 */

import { createHash } from 'node:crypto';
import type { DesignHarmonyFinding, HarmonySeverity } from './types.js';

export function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  const propNames = Object.getOwnPropertyNames(obj);
  for (const name of propNames) {
    const value = (obj as Record<string, unknown>)[name];
    if (value !== null && typeof value === 'object') {
      deepFreeze(value);
    }
  }
  return Object.freeze(obj);
}

export function parseRgb(colorStr: string): [number, number, number] | null {
  if (!colorStr) return null;
  const clean = colorStr.trim().toLowerCase();

  if (clean === 'transparent' || clean === 'inherit' || clean === 'currentcolor') {
    return null;
  }

  // Named colors quick lookup
  if (clean === 'white') return [255, 255, 255];
  if (clean === 'black') return [0, 0, 0];
  if (clean === 'red') return [255, 0, 0];
  if (clean === 'blue') return [0, 0, 255];
  if (clean === 'green') return [0, 128, 0];

  // 3-digit hex: #abc
  const hex3Match = clean.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  if (hex3Match) {
    const r = parseInt(`${hex3Match[1]}${hex3Match[1]}`, 16);
    const g = parseInt(`${hex3Match[2]}${hex3Match[2]}`, 16);
    const b = parseInt(`${hex3Match[3]}${hex3Match[3]}`, 16);
    return [r, g, b];
  }

  // 6 or 8-digit hex: #abcdef or #abcdef00
  const hex6Match = clean.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (hex6Match) {
    const r = parseInt(hex6Match[1]!, 16);
    const g = parseInt(hex6Match[2]!, 16);
    const b = parseInt(hex6Match[3]!, 16);
    return [r, g, b];
  }

  // rgb(...) or rgba(...)
  const rgbMatch = clean.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgbMatch) {
    const r = Math.min(255, Math.max(0, parseInt(rgbMatch[1]!, 10)));
    const g = Math.min(255, Math.max(0, parseInt(rgbMatch[2]!, 10)));
    const b = Math.min(255, Math.max(0, parseInt(rgbMatch[3]!, 10)));
    return [r, g, b];
  }

  return null;
}

export function computeRelativeLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((val) => {
    const s = val / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

export function computeContrastRatio(fgColorStr: string, bgColorStr: string): number {
  const fgRgb = parseRgb(fgColorStr);
  const bgRgb = parseRgb(bgColorStr);

  if (!fgRgb || !bgRgb) {
    // Default fallback contrast
    return 21;
  }

  const l1 = computeRelativeLuminance(fgRgb);
  const l2 = computeRelativeLuminance(bgRgb);

  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);

  const ratio = (lighter + 0.05) / (darker + 0.05);
  return Math.round(ratio * 100) / 100;
}

export function computeColorDistance(c1Str: string, c2Str: string): number {
  const rgb1 = parseRgb(c1Str);
  const rgb2 = parseRgb(c2Str);

  if (!rgb1 || !rgb2) return 999;

  const dr = rgb1[0] - rgb2[0];
  const dg = rgb1[1] - rgb2[1];
  const db = rgb1[2] - rgb2[2];

  return Math.sqrt(dr * dr + dg * dg + db * db);
}

const SEVERITY_WEIGHT: Record<HarmonySeverity, number> = {
  CRITICAL: 5,
  HIGH: 4,
  MEDIUM: 3,
  LOW: 2,
  INFO: 1
};

export function compareFindings(a: DesignHarmonyFinding, b: DesignHarmonyFinding): number {
  const weightDiff = (SEVERITY_WEIGHT[b.severity] ?? 0) - (SEVERITY_WEIGHT[a.severity] ?? 0);
  if (weightDiff !== 0) return weightDiff;

  const catDiff = a.category.localeCompare(b.category);
  if (catDiff !== 0) return catDiff;

  const pageDiff = a.pageRoute.localeCompare(b.pageRoute);
  if (pageDiff !== 0) return pageDiff;

  return a.id.localeCompare(b.id);
}

export function computeDesignHarmonyReportHash(data: {
  tenantId: string;
  projectId: string;
  overallScore: number;
  routes: readonly string[];
  findingsCount: number;
}): string {
  const raw = `${data.tenantId}:${data.projectId}:${data.overallScore}:${data.routes.slice().sort().join(',')}:${data.findingsCount}`;
  return 'dhr:' + createHash('sha256').update(raw, 'utf8').digest('hex').substring(0, 16);
}
