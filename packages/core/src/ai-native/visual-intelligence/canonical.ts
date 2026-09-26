/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-011)
 * Visual Intelligence - Canonical Hashing & Normalization Utilities
 */

import { createHash } from 'node:crypto';
import type {
  InteractiveElementProfile,
  NormalizedDomNode,
  ViewportDimension
} from './types.js';

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

export function computeVisualSnapshotHash(data: {
  tenantId: string;
  projectId: string;
  viewport: ViewportDimension;
  rootNode: NormalizedDomNode;
  extractedColors: readonly string[];
  extractedFonts: readonly string[];
}): string {
  const raw = `${data.tenantId}:${data.projectId}:${data.viewport.kind}:${data.viewport.width}x${data.viewport.height}:${data.rootNode.id}:${data.rootNode.children.length}:${data.extractedColors.slice().sort().join(',')}:${data.extractedFonts.slice().sort().join(',')}`;
  return 'vis:' + createHash('sha256').update(raw, 'utf8').digest('hex').substring(0, 16);
}

const NAMED_COLORS: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  transparent: 'transparent',
  inherit: 'inherit',
  currentcolor: 'currentColor'
};

export function canonicalizeColor(colorStr: string): string {
  if (!colorStr) return 'transparent';
  const clean = colorStr.trim().toLowerCase();

  if (NAMED_COLORS[clean]) {
    return NAMED_COLORS[clean];
  }

  // 3-digit hex: #fff -> #ffffff
  const hex3Match = clean.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  if (hex3Match) {
    const [, r, g, b] = hex3Match;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }

  // 6-digit hex
  const hex6Match = clean.match(/^#([0-9a-f]{6})/i);
  if (hex6Match) {
    return hex6Match[0].toLowerCase();
  }

  // 8-digit hex (with alpha): ignore alpha if ff
  const hex8Match = clean.match(/^#([0-9a-f]{6})([0-9a-f]{2})/i);
  if (hex8Match) {
    return `#${hex8Match[1]}`.toLowerCase();
  }

  // rgb(r, g, b) or rgba(r, g, b, a)
  const rgbMatch = clean.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (rgbMatch) {
    const r = Math.min(255, Math.max(0, parseInt(rgbMatch[1]!, 10)));
    const g = Math.min(255, Math.max(0, parseInt(rgbMatch[2]!, 10)));
    const b = Math.min(255, Math.max(0, parseInt(rgbMatch[3]!, 10)));
    const a = rgbMatch[4] !== undefined ? parseFloat(rgbMatch[4]) : 1;

    if (a === 0) return 'transparent';
    if (a > 0 && a < 1) {
      return `rgba(${r},${g},${b},${a})`;
    }

    const hexR = r.toString(16).padStart(2, '0');
    const hexG = g.toString(16).padStart(2, '0');
    const hexB = b.toString(16).padStart(2, '0');
    return `#${hexR}${hexG}${hexB}`.toLowerCase();
  }

  return clean;
}

export function canonicalizeLength(lenStr: string, baseFontSize = 16): number {
  if (!lenStr) return 0;
  const clean = lenStr.trim().toLowerCase();

  if (clean === '0' || clean === 'auto' || clean === 'none') {
    return 0;
  }

  if (clean.endsWith('px')) {
    const val = parseFloat(clean.replace('px', ''));
    return Number.isFinite(val) ? val : 0;
  }

  if (clean.endsWith('rem') || clean.endsWith('em')) {
    const val = parseFloat(clean.replace(/r?em/, ''));
    return Number.isFinite(val) ? Math.round(val * baseFontSize) : 0;
  }

  const num = parseFloat(clean);
  return Number.isFinite(num) ? num : 0;
}

export function compareInteractiveElements(
  a: InteractiveElementProfile,
  b: InteractiveElementProfile
): number {
  if (a.bounds.y !== b.bounds.y) {
    return a.bounds.y - b.bounds.y;
  }
  if (a.bounds.x !== b.bounds.x) {
    return a.bounds.x - b.bounds.x;
  }
  return a.nodeId.localeCompare(b.nodeId);
}
