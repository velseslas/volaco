/**
 * ÉTAPE 10 — VISUAL COMPONENT SYSTEM enrichi : visuels crédibles par type,
 * révélation progressive en CSS pur, données RÉELLES affichées quand elles
 * existent (metadata du flux), fallback générique intact.
 *
 * Séparation stricte conservée :
 *   Component Definition (id/type/label/metadata — moteur, sans HTML)
 *   ≠ Visual Representation (ce module — décide COMMENT afficher)
 *
 * - registry OUVERT : registerVisual(type, fn) sans toucher au moteur ;
 * - type inconnu → visual générique (jamais vide, jamais de crash) ;
 * - deux modes : 'building' (titre + zones ghost séquencées en CSS) et
 *   'completed' (contenu final stable) ;
 * - metadata.html (HTML réel généré par l'IA, transporté par le flux) est
 *   affiché tel quel à completed — mêmes règles de confiance que l'ancien
 *   preview (même provenance, même contexte d'affichage) ;
 * - PUR : même entrée → même HTML, zéro timer, zéro mutation du state.
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

/** Zones de contenu fantômes : séquence CSS (shimmer + fill décalés). */
function ghosts(count = 2, widths: number[] = [85, 65]): string {
  const bars: string[] = [];
  for (let i = 0; i < count; i++) {
    const w = widths[i % widths.length]!;
    bars.push(`<div class="pv-ghost g${i + 1}" style="width:${w}%"></div>`);
  }
  return `<div class="pvz-ghosts">${bars.join('')}</div>`;
}

/** ÉTAPE 11 — pilules fantômes en ligne (nav, actions) : silhouette finale. */
function ghostPills(pxs: number[]): string {
  return `<div class="pvz-ghost-row">` + pxs.map((w, i) =>
    `<div class="pv-ghost pvz-ghost-pill" style="width:${w}px; animation-delay:0s,${.7 + i * .12}s"></div>`).join('') + `</div>`;
}

/** ÉTAPE 11 — blocs fantômes flexibles (colonnes de footer, zones). */
function ghostBlocks(count = 3): string {
  return `<div class="pvz-ghost-row">` + Array.from({ length: count }, (_, i) =>
    `<div class="pv-ghost pvz-ghost-block" style="animation-delay:0s,${.7 + i * .1}s"></div>`).join('') + `</div>`;
}

/** ÉTAPE 11 — colonnes fantômes de graphique : la silhouette ▂▄▆ du rendu final. */
function ghostCols(heights: number[]): string {
  return heights.map((h, i) =>
    `<div class="pv-ghost pvz-col-ghost" style="height:${h}%; animation-delay:0s,${.55 + i * .1}s"></div>`).join('');
}

function esc(text: unknown): string {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ==================== VISUELS PAR TYPE ==================== */

function headerVisual(c: VisualComponent, mode: 'building' | 'completed'): string {
  const brand = (c.metadata?.title as string) || c.label || 'App';
  const links = (c.metadata?.links as number) || 3;
  if (mode === 'building') {
    // ÉTAPE 11 — squelette réel : marque révélée + pilules nav + pilule CTA
    return `<div class="pvz-header"><span class="pvz-brand pvz-anim">${esc(brand)}</span>${ghostPills([34, 44, 30])}<div class="pv-ghost pvz-ghost-pill pvz-cta-ghost" style="animation-delay:0s,1.05s"></div></div>`;
  }
  const nav = Array.from({ length: links as number }, (_, i) =>
    `<span class="pvz-nav-item pvz-anim" style="animation-delay:${.15 + i * .08}s">Section ${i + 1}</span>`).join('');
  return `<div class="pvz-header"><span class="pvz-brand pvz-anim">${esc(brand)}</span><nav class="pvz-nav">${nav}</nav><span class="pvz-cta pvz-anim" style="animation-delay:.4s">Action</span></div>`;
}

function sidebarVisual(c: VisualComponent, mode: 'building' | 'completed'): string {
  const items = (c.metadata?.items as number) || 4;
  if (mode === 'building') {
    return `<div class="pvz-sidebar"><div class="pvz-side-title pvz-anim">${esc(c.label || 'Navigation')}</div>${ghosts(4, [80, 65, 72, 55])}</div>`;
  }
  const list = Array.from({ length: items as number }, (_, i) =>
    `<span class="pvz-side-item pvz-anim" style="animation-delay:${.1 + i * .09}s">Élément ${i + 1}</span>`).join('');
  return `<div class="pvz-sidebar">${list}</div>`;
}

function heroVisual(c: VisualComponent, mode: 'building' | 'completed'): string {
  const title = (c.metadata?.title as string) || c.label || 'Titre';
  const subtitle = (c.metadata?.subtitle as string) || '';
  if (mode === 'building') {
    // ÉTAPE 11 — titre + lignes + action : le héros se dessine en entier
    return `<div class="pvz-hero"><div class="pvz-hero-title pvz-anim">${esc(title)}</div>${ghosts(2, [55, 40])}<div class="pv-ghost pvz-cta-ghost" style="animation-delay:0s,1.2s"></div></div>`;
  }
  // ÉTAPE 12 — héros composé : titre, sous-titre, action (structure de
  // présentation, aucune donnée métier codée en dur)
  return `<div class="pvz-hero"><div class="pvz-hero-title pvz-anim">${esc(title)}</div>${subtitle ? `<div class="pvz-hero-sub pvz-anim" style="animation-delay:.15s">${esc(subtitle)}</div>` : ''}<div class="pvz-hero-actions pvz-anim" style="animation-delay:.3s"><span class="pvz-hero-cta">Action</span></div></div>`;
}

function contentVisual(c: VisualComponent, mode: 'building' | 'completed'): string {
  if (mode === 'building') {
    return `<div class="pvz-content"><span class="pvz-zone-label pvz-anim">${esc(c.label || 'Zone')}</span>${ghosts(1, [30])}</div>`;
  }
  return `<div class="pvz-content"><span class="pvz-zone-label pvz-anim">${esc(c.label || 'Zone')}</span></div>`;
}

function cardVisual(c: VisualComponent, mode: 'building' | 'completed'): string {
  const title = (c.metadata?.title as string) || c.label || 'Carte';
  if (mode === 'building') {
    // ÉTAPE 11 — titre révélé tôt, valeur + delta en fantômes décalés (CSS)
    return `<div class="pvz-card"><div class="pvz-card-title pvz-anim">${esc(title)}</div><div class="pv-ghost pvz-value-ghost"></div><div class="pv-ghost g1" style="width:35%; animation-delay:0s,1.1s"></div></div>`;
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
    // ÉTAPE 11 — colonnes fantômes de hauteurs variées : la silhouette du
    // graphique final est visible PENDANT la construction
    return `<div class="pvz-chart"><div class="pvz-chart-title pvz-anim">${esc(c.label || 'Graphique')}</div><div class="pvz-bars">${ghostCols([38, 62, 48, 78, 56, 88])}</div></div>`;
  }
  const heights = (c.metadata?.bars as number[]) || [45, 70, 55, 85, 60, 95];
  const bars = heights.map((h, i) => `<div class="pvz-col pvz-anim" style="height:${h}%; animation-delay:${.08 * i}s"></div>`).join('');
  return `<div class="pvz-chart"><div class="pvz-bars">${bars}</div></div>`;
}

function tableVisual(c: VisualComponent, mode: 'building' | 'completed'): string {
  const rows = (c.metadata?.rows as number) || 3;
  if (mode === 'building') {
    return `<div class="pvz-table"><div class="pvz-table-title pvz-anim">${esc(c.label || 'Tableau')}</div>${ghosts(3, [90, 75, 82])}</div>`;
  }
  const lines = Array.from({ length: rows as number }, (_, i) =>
    `<div class="pvz-table-row pvz-anim" style="animation-delay:${.1 * i}s"><span>Ligne ${i + 1}</span><span>Valeur</span></div>`).join('');
  return `<div class="pvz-table">${lines}</div>`;
}

function footerVisual(c: VisualComponent, mode: 'building' | 'completed'): string {
  const columns = (c.metadata?.columns as number) || 3;
  if (mode === 'building') {
    // ÉTAPE 11 — blocs de colonnes fantômes : la grille du pied se voit déjà
    return `<div class="pvz-footer"><div class="pvz-foot-title pvz-anim">${esc(c.label || 'Pied de page')}</div>${ghostBlocks(3)}</div>`;
  }
  // ÉTAPE 12 — colonnes groupées (titre + entrées) : structure de
  // présentation générique, aucune donnée métier
  const cols = Array.from({ length: columns as number }, (_, i) =>
    `<div class="pvz-foot-col pvz-anim" style="animation-delay:${.1 * i}s"><div class="pvz-foot-head">Colonne ${i + 1}</div><span>Rubrique</span><span>Rubrique</span></div>`).join('');
  return `<div class="pvz-footer">${cols}</div>`;
}

function genericVisual(c: VisualComponent, mode: 'building' | 'completed'): string {
  if (mode === 'building') {
    return `<div class="pvz-generic"><div class="pvz-gen-title pvz-anim">${esc(c.label || c.id)}</div>${ghosts(1, [50])}</div>`;
  }
  return `<div class="pvz-generic"><span class="pvz-anim">${esc(c.label || c.id)}</span><span class="pvz-type-tag">${esc(c.type)}</span></div>`;
}

/* ==================== REGISTRY PAR DÉFAUT ==================== */

registerVisual('header', headerVisual);
registerVisual('sidebar', sidebarVisual);
registerVisual('hero', heroVisual);
registerVisual('content', contentVisual);
registerVisual('card', cardVisual);
registerVisual('chart', chartVisual);
registerVisual('table', tableVisual);
registerVisual('footer', footerVisual);

/**
 * Rend le visuel d'un composant selon son type et son statut.
 * - type inconnu → visual générique (extensibilité, brief) ;
 * - pending → chaîne vide (le canvas ne l'affiche pas) ;
 * - completed avec metadata.html → le HTML RÉEL généré par l'IA est affiché
 *   (données réelles, spec « données réelles ») — enveloppé pour préserver
 *   le reveal CSS ;
 * - PUR : même entrée → même HTML, aucune mutation, aucun timer.
 */
export function renderComponentVisual(component: VisualComponent, status: 'pending' | 'building' | 'completed' | 'error'): string {
  if (status === 'pending') return '';
  if (status === 'error') {
    return `<div class="pvz-generic pvz-error">⚠ ${esc(component.label || component.id)} — génération impossible</div>`;
  }
  const renderer = registry.get(component.type) || genericVisual;
  try {
    const mode = status === 'building' ? 'building' : 'completed';
    // DONNÉES RÉELLES : à completed, le HTML réel généré par l'IA (transporté
    // par le flux) est prioritaire sur le visuel de démonstration.
    const realHtml = (component.metadata?.html as string) || '';
    if (mode === 'completed' && realHtml.length > 40) {
      return `<div class="pvz-real pvz-anim">${realHtml}</div>`;
    }
    return renderer(component, mode);
  } catch {
    // Un visuel défectueux ne casse jamais le preview
    return `<div class="pvz-generic">${esc(component.label || component.id)}</div>`;
  }
}
