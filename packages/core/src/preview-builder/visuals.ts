/**
 * ÉTAPE 05 — VISUAL COMPONENT SYSTEM : registry type → représentation visuelle.
 *
 * Séparation stricte (brief) :
 *   Component Definition (id/type/label/metadata — moteur, sans HTML)
 *   ≠ Visual Representation (ce module — décide COMMENT afficher)
 *
 * - registry OUVERT : `registerVisual('hero', fn)` ajoute un nouveau type
 *   sans modifier le moteur ni ce module ;
 * - type inconnu → visual générique (jamais vide, jamais de crash) ;
 * - deux modes par visuel : 'building' (titre révélé + zones ghost) et
 *   'completed' (contenu final stable) — pilotés par le STATUT du state ;
 * - PUR : aucune mutation du state, aucun timer, aucune animation inline —
 *   les transitions vivent en CSS côté page (neutralisables reduced-motion).
 */

export interface VisualComponent {
  id: string;
  type: string;
  label?: string;
  metadata?: Record<string, unknown>;
}

export type VisualRenderer = (component: VisualComponent, mode: 'building' | 'completed') => string;

const registry = new Map<string, VisualRenderer>();

/** Ajoute/remplace le visuel d'un type (extension ouverte, sans toucher au moteur). */
export function registerVisual(type: string, renderer: VisualRenderer): void {
  registry.set(type, renderer);
}

export function hasVisual(type: string): boolean {
  return registry.has(type);
}

/** Zones de contenu fantômes génériques (révélation progressive en CSS). */
function ghosts(): string {
  return '<div class="pvz-ghosts"><div class="pv-ghost g1"></div><div class="pv-ghost g2"></div></div>';
}

function esc(text: unknown): string {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ==================== VISUELS PAR DÉFAUT ==================== */

function headerVisual(c: VisualComponent, mode: 'building' | 'completed'): string {
  const brand = (c.metadata?.title as string) || c.label || 'App';
  const links = (c.metadata?.links as number) || 3;
  if (mode === 'building') {
    return `<div class="pvz-header"><span class="pvz-brand pvz-anim">${esc(brand)}</span>${ghosts()}</div>`;
  }
  const nav = Array.from({ length: links as number }, (_, i) => `<span class="pvz-nav-item pvz-anim" style="animation-delay:${.15 + i * .08}s">Section ${i + 1}</span>`).join('');
  return `<div class="pvz-header"><span class="pvz-brand pvz-anim">${esc(brand)}</span><nav class="pvz-nav">${nav}</nav><span class="pvz-cta pvz-anim" style="animation-delay:.4s">Action</span></div>`;
}

function sidebarVisual(c: VisualComponent, mode: 'building' | 'completed'): string {
  const items = (c.metadata?.items as number) || 4;
  if (mode === 'building') {
    return `<div class="pvz-sidebar">${ghosts()}</div>`;
  }
  const list = Array.from({ length: items as number }, (_, i) => `<span class="pvz-side-item pvz-anim" style="animation-delay:${.1 + i * .09}s">Élément ${i + 1}</span>`).join('');
  return `<div class="pvz-sidebar">${list}</div>`;
}

function contentVisual(c: VisualComponent, mode: 'building' | 'completed'): string {
  if (mode === 'building') {
    return `<div class="pvz-content">${ghosts()}</div>`;
  }
  return `<div class="pvz-content"><span class="pvz-zone-label pvz-anim">${esc(c.label || 'Zone')}</span></div>`;
}

function cardVisual(c: VisualComponent, mode: 'building' | 'completed'): string {
  const title = (c.metadata?.title as string) || c.label || 'Carte';
  if (mode === 'building') {
    return `<div class="pvz-card"><div class="pvz-card-title pvz-anim">${esc(title)}</div>${ghosts()}</div>`;
  }
  const value = (c.metadata?.value as string) || '—';
  const delta = (c.metadata?.delta as string) || '';
  return `<div class="pvz-card">`
    + `<div class="pvz-card-title pvz-anim">${esc(title)}</div>`
    + `<div class="pvz-card-value pvz-anim" style="animation-delay:.12s">${esc(value)}</div>`
    + (delta ? `<div class="pvz-card-delta pvz-anim" style="animation-delay:.24s">${esc(delta)}</div>` : '')
    + `</div>`;
}

function chartVisual(c: VisualComponent, mode: 'building' | 'completed'): string {
  if (mode === 'building') {
    return `<div class="pvz-chart">${ghosts()}</div>`;
  }
  const heights = (c.metadata?.bars as number[]) || [45, 70, 55, 85, 60, 95];
  const bars = heights.map((h, i) => `<div class="pvz-bar pvz-anim" style="height:${h}%; animation-delay:${.08 * i}s"></div>`).join('');
  return `<div class="pvz-chart"><div class="pvz-bars">${bars}</div></div>`;
}

function tableVisual(c: VisualComponent, mode: 'building' | 'completed'): string {
  const rows = (c.metadata?.rows as number) || 3;
  if (mode === 'building') {
    return `<div class="pvz-table">${ghosts()}</div>`;
  }
  const lines = Array.from({ length: rows as number }, (_, i) =>
    `<div class="pvz-table-row pvz-anim" style="animation-delay:${.1 * i}s"><span>Ligne ${i + 1}</span><span>Valeur</span></div>`).join('');
  return `<div class="pvz-table">${lines}</div>`;
}

function genericVisual(c: VisualComponent, mode: 'building' | 'completed'): string {
  if (mode === 'building') {
    return `<div class="pvz-generic">${ghosts()}</div>`;
  }
  return `<div class="pvz-generic"><span class="pvz-anim">${esc(c.label || c.id)}</span><span class="pvz-type-tag">${esc(c.type)}</span></div>`;
}

/* ==================== REGISTRY PAR DÉFAUT ==================== */

registerVisual('header', headerVisual);
registerVisual('sidebar', sidebarVisual);
registerVisual('content', contentVisual);
registerVisual('card', cardVisual);
registerVisual('chart', chartVisual);
registerVisual('table', tableVisual);

/**
 * Rend le visuel d'un composant selon son type et son statut.
 * - type inconnu → visual générique (extensibilité, brief) ;
 * - pending → chaîne vide (le canvas ne l'affiche pas) ;
 * - PUR : même entrée → même HTML, aucune mutation, aucun timer.
 */
export function renderComponentVisual(component: VisualComponent, status: 'pending' | 'building' | 'completed' | 'error'): string {
  if (status === 'pending') return '';
  const renderer = registry.get(component.type) || genericVisual;
  try {
    return renderer(component, status === 'building' ? 'building' : 'completed');
  } catch {
    // Un visuel défectueux ne casse jamais le preview
    return `<div class="pvz-generic">${esc(component.label || component.id)}</div>`;
  }
}
